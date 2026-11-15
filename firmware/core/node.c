/* The VIGIL node's application. See node.h. */
#include "node.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void vnode_init(vnode *n) {
    memset(n, 0, sizeof *n);
    n->n_base = VNODE_BASE;
    n->last.hi = -1;
    n->st.named = VIGIL_NONE;
}

void vnode_config_default(vnode_config *c) {
    memset(c, 0, sizeof *c);
    strcpy(c->id, "VIGIL-0001");
    c->rollers = 16; c->roller_dia = 0.331; c->pitch_dia = 2.815; c->contact_deg = 15.17;   /* NASA IMS rig bearing until set */
    c->rpm = 2000;
    c->axis = 2;
    c->passkey = 246810;
}

void vnode_restore(vnode *n, const vigil_state *st) {
    n->st = *st;
    n->have_state = 1;
    n->learned = n->n_base;
}

/* ---- the ten-minute clock ---- */
int vnode_due(const vnode *n, uint32_t now) { return (int32_t)(now - n->next_due) >= 0; }

uint32_t vnode_sleep_s(const vnode *n, uint32_t now) {
    int32_t left = (int32_t)(n->next_due - now);
    return left > 1 ? (uint32_t)left : 1;
}

/* ---- readings ---- */
static void trend_push(vnode *n, uint16_t v) {
    if (n->trend_n < VNODE_TREND) { n->trend[(n->trend_head + n->trend_n) % VNODE_TREND] = v; n->trend_n++; }
    else { n->trend[n->trend_head] = v; n->trend_head = (uint16_t)((n->trend_head + 1) % VNODE_TREND); }
}

static void reduce(const vnode_config *c, vigil_ws *ws, const vreal *x, double fs, vnode_reading *r) {
    vigil_orders o = vigil_bearing_orders(c->rollers, c->roller_dia, c->pitch_dia, c->contact_deg);
    vigil_result res;
    vigil_features_r(ws, x, fs, c->rpm / 60.0, &o, r->f, &res);
    r->fs = fs; r->band_lo = res.band_lo; r->band_hi = res.band_hi;
    r->hi = -1; r->valid = 1; r->stopped = 0;
}

int vnode_scheduled(vnode *n, const vnode_config *c, vigil_ws *ws, const vreal *x, double fs, uint32_t now) {
    /* keep to the ten-minute grid, and start a new one after a long gap */
    n->next_due = now - n->next_due >= VNODE_PERIOD_S ? now + VNODE_PERIOD_S : n->next_due + VNODE_PERIOD_S;
    n->last_at = now;
    n->snapshots++;
    if (fs <= 0) {                                   /* a gap in the record: no reading this time */
        n->last.valid = 0; n->last.hi = -1;
        trend_push(n, VNODE_TREND_STOPPED);
        return 0;
    }
    reduce(c, ws, x, fs, &n->last);
    if (!n->have_state) {
        if (exp(n->last.f[0]) < VNODE_RUNNING_G) {   /* stopped: nothing to learn from */
            n->last.stopped = 1;
            trend_push(n, VNODE_TREND_STOPPED);
            return 0;
        }
        for (int j = 0; j < VIGIL_NFEAT; j++) n->base_rows[n->learned][j] = (float)n->last.f[j];
        trend_push(n, VNODE_TREND_LEARNING);
        if (++n->learned < n->n_base) return 0;
        double *rows = (double *)malloc((size_t)n->n_base * VIGIL_NFEAT * sizeof(double));
        if (!rows) { n->learned--; return 0; }       /* no memory this time: learn on the next snapshot */
        for (int i = 0; i < n->n_base; i++)
            for (int j = 0; j < VIGIL_NFEAT; j++) rows[i * VIGIL_NFEAT + j] = n->base_rows[i][j];
        vigil_learn(&n->st, rows, n->n_base);
        free(rows);
        n->have_state = 1;
        return VNODE_SAVE_STATE;
    }
    int was_alarm = n->st.alarm, was_named = n->st.named;
    double hi = vigil_watch(&n->st, n->last.f);
    n->last.hi = hi; n->last.stopped = hi < 0;
    trend_push(n, hi < 0 ? VNODE_TREND_STOPPED : (uint16_t)(hi >= 650 ? 65000 : hi * 100 + 0.5));
    if (n->st.alarm == was_alarm && n->st.named == was_named) return 0;
    /* the reading that tipped it is what the mechanic is shown as the reason */
    n->raised = n->last; n->raised_at = now; n->raised_snap = n->snapshots;
    /* flash only when something a mechanic would act on changes; the running
       counters live in RTC memory, and losing them to a power cut is harmless */
    return VNODE_SAVE_STATE;
}

void vnode_spot(const vnode *n, const vnode_config *c, vigil_ws *ws, const vreal *x, double fs, vnode_reading *out) {
    memset(out, 0, sizeof *out);
    out->hi = -1;
    if (fs <= 0) return;
    reduce(c, ws, x, fs, out);
    if (!n->have_state) return;
    if (exp(out->f[0]) < 0.3 * n->st.base_level) { out->stopped = 1; return; }
    double hi = 0;                                   /* vigil_watch's score, without its memory */
    for (int j = 0; j < VIGIL_NFEAT; j++) {
        double z = fabs(out->f[j] - n->st.med[j]) / n->st.mad[j];
        if (z > hi) hi = z;
    }
    out->hi = hi;
}

/* ---- what the node says ---- */
static const char *part_name(int p) {
    return p == VIGIL_BPFO ? "outer race" : p == VIGIL_BPFI ? "inner race" : p == VIGIL_BSF ? "rolling element" : "none";
}

static const char *reading_word(const vnode_reading *r) { return !r->valid ? "void" : r->stopped ? "stopped" : "ok"; }

int vnode_status(const vnode *n, const vnode_config *c, uint32_t now, char *buf, size_t cap) {
    const char *phase = !n->have_state ? "learning" : n->st.alarm || n->st.named != VIGIL_NONE ? "warning" : "normal";
    const vnode_reading *r = &n->last;
    return snprintf(buf, cap,
        "VIGIL1|id=%s|fw=%d|phase=%s|learned=%d/%d|snap=%lu|age=%lu|read=%s|hi=%.2f|part=%s|alarm=%d"
        "|outer=%.1f|inner=%.1f|ball=%.1f|rms_g=%.4f|fs=%.1f|rpm=%.6g|brg=%.6g/%.6g/%.6g/%.6g|axis=%d",
        c->id, VNODE_FW, phase, (int)n->learned, (int)n->n_base, (unsigned long)n->snapshots,
        (unsigned long)(n->snapshots ? now - n->last_at : 0), n->snapshots ? reading_word(r) : "none", r->hi,
        n->have_state ? part_name(n->st.named) : "none", n->have_state ? n->st.alarm : 0,
        r->f[3], r->f[4], r->f[5], r->valid ? exp(r->f[0]) : 0.0, r->fs, c->rpm,
        c->rollers, c->roller_dia, c->pitch_dia, c->contact_deg, (int)c->axis);
}

void vnode_spot_reply(const vnode *n, const vnode_reading *r, vnode_emit emit, void *ctx) {
    char buf[VNODE_LINE];
    (void)n;
    if (!r->valid) { emit(ctx, "ERR SNAP the capture had a gap, try again"); return; }
    int top = 0;
    for (int k = 1; k < 3; k++) if (r->f[3 + k] > r->f[3 + top]) top = k;
    snprintf(buf, sizeof buf, "SPOT|read=%s|hi=%.2f|points=%s|outer=%.1f|inner=%.1f|ball=%.1f|rms_g=%.4f|fs=%.1f",
             reading_word(r), r->hi, r->f[3 + top] >= 10 ? part_name(top) : "none", r->f[3], r->f[4], r->f[5], exp(r->f[0]), r->fs);
    emit(ctx, buf);
    emit(ctx, "OK SNAP");
}

uint32_t vnode_crc32(uint32_t crc, const uint8_t *p, size_t len) {
    crc = ~crc;
    while (len--) {
        crc ^= *p++;
        for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1)));
    }
    return ~crc;
}

static size_t b64(const uint8_t *in, size_t len, char *out) {
    static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t o = 0;
    for (size_t i = 0; i < len; i += 3) {
        uint32_t v = (uint32_t)in[i] << 16 | (i + 1 < len ? (uint32_t)in[i + 1] << 8 : 0) | (i + 2 < len ? in[i + 2] : 0);
        out[o++] = T[v >> 18]; out[o++] = T[(v >> 12) & 63];
        out[o++] = i + 1 < len ? T[(v >> 6) & 63] : '=';
        out[o++] = i + 2 < len ? T[v & 63] : '=';
    }
    out[o] = 0;
    return o;
}

/* 168 bytes a line: with its prefix and newline it fits one Bluetooth
   notification at the 247-byte MTU phones negotiate, so a recording is 391
   notifications and not twice that. */
#define CHUNK 168

/* 16-bit words, little-endian, base64, CHUNK bytes to a line */
static uint32_t send_words(const char *tag, uint32_t count, uint16_t (*word)(const void *, uint32_t), const void *src,
                           vnode_emit emit, void *ctx) {
    uint8_t raw[CHUNK];
    char line[VNODE_LINE];
    uint32_t crc = 0, seq = 0;
    for (uint32_t i = 0; i < count;) {
        size_t len = 0;
        for (; len < CHUNK && i < count; i++) { uint16_t w = word(src, i); raw[len++] = (uint8_t)(w & 255); raw[len++] = (uint8_t)(w >> 8); }
        crc = vnode_crc32(crc, raw, len);
        int at = snprintf(line, sizeof line, "%s|%lu|", tag, (unsigned long)seq++);
        b64(raw, len, line + at);
        emit(ctx, line);
    }
    return crc;
}

static uint16_t trend_word(const void *src, uint32_t i) {
    const vnode *n = (const vnode *)src;
    return n->trend[(n->trend_head + i) % VNODE_TREND];
}

static uint16_t raw_word(const void *src, uint32_t i) {
    const vnode_raw *r = (const vnode_raw *)src;
    long q = lround((double)r->x[i] / r->scale);
    return (uint16_t)(int16_t)(q > 32767 ? 32767 : q < -32768 ? -32768 : q);
}

/* ---- what the node is told ---- */
static int relearn(vnode *n) {
    n->learned = 0;
    n->have_state = 0;
    n->raised.valid = 0;
    memset(&n->st, 0, sizeof n->st);
    n->st.named = VIGIL_NONE;
    return VNODE_SAVE_STATE;
}

static int number(const char *v, double lo, double hi, double *out) {
    char *end;
    double d = strtod(v, &end);
    if (end == v || *end || !(d >= lo && d <= hi)) return 0;
    *out = d;
    return 1;
}

static int set(vnode *n, vnode_config *c, const char *kv, const char **err) {
    const char *eq = strchr(kv, '=');
    size_t klen = eq ? (size_t)(eq - kv) : 0;
    const char *v = eq ? eq + 1 : "";
    double d;
#define KEY(name) (klen == sizeof(name) - 1 && !memcmp(kv, name, klen))
    if (KEY("id")) {
        size_t len = strlen(v);
        if (!len || len >= sizeof c->id) { *err = "id is 1 to 23 characters"; return -1; }
        for (size_t i = 0; i < len; i++) {
            char ch = v[i];
            int ok = (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '-' || ch == '_' || ch == '.';
            if (!ok) { *err = "id takes letters, digits, dot, hyphen and underscore"; return -1; }
        }
        memset(c->id, 0, sizeof c->id);
        memcpy(c->id, v, len);
        return VNODE_SAVE_CFG;
    }
    if (KEY("passkey")) {
        if (strlen(v) != 6 || !number(v, 0, 999999, &d) || d != floor(d)) { *err = "passkey is six digits"; return -1; }
        c->passkey = (uint32_t)d;
        return VNODE_SAVE_CFG;
    }
    /* everything below changes what the machine's readings mean, so the node learns a new normal */
    if (KEY("brg")) {
        double g[4];
        char part[4][24];
        if (sscanf(v, "%23[^/]/%23[^/]/%23[^/]/%23[^/]", part[0], part[1], part[2], part[3]) != 4 ||
            !number(part[0], 3, 60, &g[0]) || !number(part[1], 1e-6, 1e6, &g[1]) || !number(part[2], 1e-6, 1e6, &g[2]) ||
            !number(part[3], 0, 45, &g[3]) || g[0] != floor(g[0]) || g[1] >= g[2]) {
            *err = "brg is rollers/roller diameter/pitch diameter/contact angle";
            return -1;
        }
        c->rollers = g[0]; c->roller_dia = g[1]; c->pitch_dia = g[2]; c->contact_deg = g[3];
    }
    else if (KEY("rollers")) { if (!number(v, 3, 60, &d) || d != floor(d)) { *err = "rollers is a whole number, 3 to 60"; return -1; } c->rollers = d; }
    else if (KEY("roller_dia")) { if (!number(v, 1e-6, 1e6, &d)) { *err = "roller_dia must be above zero"; return -1; } c->roller_dia = d; }
    else if (KEY("pitch_dia")) { if (!number(v, 1e-6, 1e6, &d)) { *err = "pitch_dia must be above zero"; return -1; } c->pitch_dia = d; }
    else if (KEY("contact_deg")) { if (!number(v, 0, 45, &d)) { *err = "contact_deg is 0 to 45"; return -1; } c->contact_deg = d; }
    else if (KEY("rpm")) { if (!number(v, 60, 30000, &d)) { *err = "rpm is 60 to 30000"; return -1; } c->rpm = d; }
    else if (KEY("axis")) { if (!number(v, 0, 2, &d) || d != floor(d)) { *err = "axis is 0, 1 or 2"; return -1; } c->axis = (uint8_t)d; }
    else { *err = "no such setting"; return -1; }
#undef KEY
    return VNODE_SAVE_CFG | relearn(n);
}

int vnode_command(vnode *n, vnode_config *c, const char *in, const vnode_raw *raw, uint32_t now,
                  vnode_emit emit, void *ctx) {
    char line[VNODE_LINE + 64], cmd[96];
    size_t len = strlen(in);
    while (len && (in[len - 1] == '\r' || in[len - 1] == '\n' || in[len - 1] == ' ')) len--;
    while (len && *in == ' ') { in++; len--; }
    if (len >= sizeof cmd) { emit(ctx, "ERR ? line too long"); return 0; }
    memcpy(cmd, in, len); cmd[len] = 0;

    if (!strcmp(cmd, "STATUS")) {
        vnode_status(n, c, now, line, sizeof line);
        emit(ctx, line);
        emit(ctx, "OK STATUS");
        return 0;
    }
    if (!strcmp(cmd, "TREND")) {
        snprintf(line, sizeof line, "TREND|n=%u|period=%d|age=%lu", (unsigned)n->trend_n, VNODE_PERIOD_S,
                 (unsigned long)(n->snapshots ? now - n->last_at : 0));
        emit(ctx, line);
        uint32_t crc = send_words("T", n->trend_n, trend_word, n, emit, ctx);
        snprintf(line, sizeof line, "TEND|crc=%08lx", (unsigned long)crc);
        emit(ctx, line);
        emit(ctx, "OK TREND");
        return 0;
    }
    if (!strcmp(cmd, "WHY")) {
        /* kept in RTC memory with the trend: after a power cut the warning stands and its reason is gone */
        if (!n->raised.valid) { emit(ctx, "ERR WHY no reading held for a warning"); return 0; }
        const vnode_reading *r = &n->raised;
        snprintf(line, sizeof line, "WHY|snap=%lu|ago=%lu|hi=%.2f|outer=%.1f|inner=%.1f|ball=%.1f|rms_g=%.4f",
                 (unsigned long)n->raised_snap, (unsigned long)(now - n->raised_at), r->hi, r->f[3], r->f[4], r->f[5], exp(r->f[0]));
        emit(ctx, line);
        emit(ctx, "OK WHY");
        return 0;
    }
    if (!strcmp(cmd, "RAW")) {
        if (!raw || !raw->x || !raw->r || !raw->r->valid) { emit(ctx, "ERR RAW no recording held"); return 0; }
        const vnode_reading *r = raw->r;
        snprintf(line, sizeof line,
                 "RAW|snap=%lu|spot=%d|n=%lu|fs=%.3f|scale=%.9g|outer=%.4f|inner=%.4f|ball=%.4f|lo=%.1f|hi=%.1f|rms_g=%.6f|rpm=%.3f",
                 (unsigned long)raw->snap, (int)raw->spot, (unsigned long)raw->n, r->fs, raw->scale, r->f[3], r->f[4], r->f[5],
                 r->band_lo, r->band_hi, exp(r->f[0]), c->rpm);
        emit(ctx, line);
        uint32_t crc = send_words("R", raw->n, raw_word, raw, emit, ctx);
        snprintf(line, sizeof line, "REND|crc=%08lx", (unsigned long)crc);
        emit(ctx, line);
        emit(ctx, "OK RAW");
        return 0;
    }
    if (!strcmp(cmd, "SNAP")) return VNODE_WANT_SPOT;   /* the board captures, then answers with vnode_spot_reply */
    if (!strcmp(cmd, "CLEAR")) {
        if (!n->have_state) { emit(ctx, "ERR CLEAR still learning, nothing to clear"); return 0; }
        n->st.alarm = 0; n->st.named = VIGIL_NONE; n->st.over = 0; n->st.named_run = 0;
        n->raised.valid = 0;
        emit(ctx, "OK CLEAR");
        return VNODE_SAVE_STATE;
    }
    if (!strcmp(cmd, "RELEARN")) {
        int flags = relearn(n);
        emit(ctx, "OK RELEARN");
        return flags;
    }
    if (!strncmp(cmd, "SET ", 4)) {
        const char *err = "";
        int flags = set(n, c, cmd + 4, &err);
        if (flags < 0) { snprintf(line, sizeof line, "ERR SET %s", err); emit(ctx, line); return 0; }
        const char *eq = strchr(cmd + 4, '=');
        snprintf(line, sizeof line, "OK SET %.*s", (int)(eq - (cmd + 4)), cmd + 4);
        emit(ctx, line);
        return flags;
    }
    emit(ctx, "ERR ? unknown command");
    return 0;
}

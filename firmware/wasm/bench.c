/* The node's application on a bench with no board: firmware/core compiled to
   WebAssembly, with a recording standing in for the accelerometer. The page
   (docs/bench.js) and the check (analysis/check_node.mjs) are its board: they
   hand it samples and a clock, and carry its lines. Built by build.sh. */
#include <stdlib.h>
#include <string.h>
#include "../core/node.h"

#define EXPORT(name) __attribute__((export_name(#name)))
__attribute__((import_module("env"), import_name("emit"))) void js_emit(const char *line, int len);

static vnode node;
static vnode_config cfg;
static vigil_ws ws;
static vreal *x;
static uint32_t N;
static double scale = 1;
static vnode_reading spot;
static vnode_raw raw;
static char line_in[VNODE_LINE];

static void emit(void *ctx, const char *line) { (void)ctx; js_emit(line, (int)strlen(line)); }

/* power on, with room for snapshots of n samples */
EXPORT(vn_boot) int vn_boot(uint32_t n) {
    size_t bytes = vigil_workspace_bytes(n);
    void *mem = malloc(bytes);
    x = (vreal *)malloc(n * sizeof(vreal));
    if (!mem || !x || vigil_workspace_init(&ws, n, mem, bytes)) return -1;
    N = n;
    vnode_init(&node);
    vnode_config_default(&cfg);
    memset(&raw, 0, sizeof raw);
    return 0;
}

EXPORT(vn_samples) vreal *vn_samples(void) { return x; }
EXPORT(vn_line) char *vn_line(void) { return line_in; }
/* the memory that survives deep sleep, and the installation, as the board would keep them */
EXPORT(vn_image) void *vn_image(void) { return &node; }
EXPORT(vn_image_bytes) uint32_t vn_image_bytes(void) { return sizeof node; }
EXPORT(vn_config) void *vn_config(void) { return &cfg; }
EXPORT(vn_config_bytes) uint32_t vn_config_bytes(void) { return sizeof cfg; }
/* for checking against an analysis whose first day was not 144 snapshots */
EXPORT(vn_set_base) void vn_set_base(int32_t n_base) { if (n_base > 0 && n_base <= VNODE_BASE_MAX) node.n_base = n_base; }

static void hold(const vnode_reading *r, int is_spot) {
    raw.x = x; raw.n = N; raw.scale = scale; raw.r = r; raw.snap = is_spot ? 0 : node.snapshots; raw.spot = (uint8_t)is_spot;
}

/* the ten-minute snapshot, on the samples now in vn_samples() */
EXPORT(vn_scheduled) int vn_scheduled(double fs, double g_per_count, uint32_t now) {
    char buf[VNODE_LINE + 64];
    scale = g_per_count;
    int flags = vnode_scheduled(&node, &cfg, &ws, x, fs, now);
    hold(&node.last, 0);
    vnode_status(&node, &cfg, now, buf, sizeof buf);
    emit(0, buf);
    return flags;
}

EXPORT(vn_spot) void vn_spot(double fs, double g_per_count) {
    scale = g_per_count;
    vnode_spot(&node, &cfg, &ws, x, fs, &spot);
    hold(&spot, 1);
    vnode_spot_reply(&node, &spot, emit, 0);
}

/* the line now in vn_line() */
EXPORT(vn_command) int vn_command(uint32_t now) {
    line_in[sizeof line_in - 1] = 0;
    return vnode_command(&node, &cfg, line_in, raw.r ? &raw : 0, now, emit, 0);
}

/* the supply fails: RTC memory is lost, and the board reads the learned normal back from flash */
EXPORT(vn_power_cut) void vn_power_cut(void) {
    vigil_state st = node.st;
    int32_t had = node.have_state, n_base = node.n_base;
    vnode_init(&node);
    node.n_base = n_base;
    if (had) vnode_restore(&node, &st);
    memset(&raw, 0, sizeof raw);
}

EXPORT(vn_due) int vn_due(uint32_t now) { return vnode_due(&node, now); }
EXPORT(vn_sleep_s) uint32_t vn_sleep_s(uint32_t now) { return vnode_sleep_s(&node, now); }
/* readings the check compares with the analysis */
EXPORT(vn_alarm) int vn_alarm(void) { return node.have_state ? node.st.alarm : 0; }
EXPORT(vn_named) int vn_named(void) { return node.have_state ? node.st.named : VIGIL_NONE; }
EXPORT(vn_hi) double vn_hi(void) { return node.last.hi; }
EXPORT(vn_feature) double vn_feature(int j) { return node.last.f[j]; }

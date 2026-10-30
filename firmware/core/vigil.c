/* VIGIL signal core. See vigil.h. Every step mirrors analysis/vigil.py; where
   numpy has a particular habit (how rfftfreq rounds, how irfft treats the DC
   and Nyquist bins, how median splits an even count) this follows it, so the
   two agree to the last few digits rather than roughly. */
#include "vigil.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

const double VIGIL_FLOOR[VIGIL_NFEAT] = {0.05, 0.10, 0.10, 1.0, 1.0, 1.0};

static int is_pow2(size_t n) { return n && !(n & (n - 1)); }
static size_t next_pow2(size_t n) { size_t m = 1; while (m < n) m <<= 1; return m; }

/* ---- memory ---- */
size_t vigil_workspace_bytes(size_t n) {
    size_t h = n / 2 + 1, L = is_pow2(n) ? n : next_pow2(2 * n - 1);
    size_t cnt = 3 * n          /* xw, e2, tmp */
               + 2 * n          /* re, im */
               + 4 * h          /* Xr, Xi, S, fr */
               + L;             /* twiddles: cos and sin, L/2 each */
    if (!is_pow2(n)) cnt += 4 * L + 2 * n;   /* ar, ai, br, bi; the chirp wr, wi */
    return cnt * sizeof(vreal) + 64;
}

static vreal *take(char **p, size_t count) {
    vreal *r = (vreal *)*p;
    *p += count * sizeof(vreal);
    return r;
}

static void radix2(vreal *re, vreal *im, size_t n, int sign, const vreal *tc, const vreal *ts, size_t tn);

int vigil_workspace_init(vigil_ws *ws, size_t n, void *mem, size_t bytes) {
    if (n < 16 || bytes < vigil_workspace_bytes(n)) return -1;
    size_t h = n / 2 + 1;
    char *p = (char *)mem;
    memset(ws, 0, sizeof *ws);
    ws->n = n;
    ws->m = is_pow2(n) ? 0 : next_pow2(2 * n - 1);
    size_t L = ws->m ? ws->m : n;
    ws->xw = take(&p, n); ws->e2 = take(&p, n); ws->tmp = take(&p, n);
    ws->re = take(&p, n); ws->im = take(&p, n);
    ws->Xr = take(&p, h); ws->Xi = take(&p, h); ws->S = take(&p, h); ws->fr = take(&p, h);
    vreal *tc = take(&p, L / 2), *ts = take(&p, L / 2);
    for (size_t k = 0; k < L / 2; k++) { tc[k] = (vreal)cos(2 * M_PI * k / L); ts[k] = (vreal)sin(2 * M_PI * k / L); }
    ws->wr = tc; ws->wi = ts;               /* the radix-2 twiddle table, for length L */
    if (ws->m) {
        size_t m = ws->m;
        ws->ar = take(&p, m); ws->ai = take(&p, m); ws->br = take(&p, m); ws->bi = take(&p, m);
        vreal *cr = take(&p, n), *ci = take(&p, n);   /* the chirp, right after bi (chirp_r, chirp_i) */
        /* w_k = exp(-i pi k^2 / n), with k^2 taken mod 2n so the angle stays exact for long snapshots */
        for (size_t k = 0; k < n; k++) {
            uint64_t q = ((uint64_t)k * k) % (2 * (uint64_t)n);
            double a = M_PI * (double)q / (double)n;
            cr[k] = (vreal)cos(a); ci[k] = (vreal)-sin(a);
        }
        /* b = conj(w), wrapped symmetrically round m, transformed once and kept */
        memset(ws->br, 0, m * sizeof(vreal)); memset(ws->bi, 0, m * sizeof(vreal));
        ws->br[0] = cr[0]; ws->bi[0] = -ci[0];
        for (size_t k = 1; k < n; k++) { ws->br[k] = ws->br[m - k] = cr[k]; ws->bi[k] = ws->bi[m - k] = -ci[k]; }
        radix2(ws->br, ws->bi, m, -1, tc, ts, m);
    }
    return 0;
}

/* the chirp sits immediately after bi in the workspace */
static vreal *chirp_r(vigil_ws *ws) { return ws->bi + ws->m; }
static vreal *chirp_i(vigil_ws *ws) { return ws->bi + ws->m + ws->n; }

/* ---- FFT ---- */
/* in place, unscaled; sign -1 forward, +1 inverse. tc/ts is a table for length tn >= n. */
static void radix2(vreal *re, vreal *im, size_t n, int sign, const vreal *tc, const vreal *ts, size_t tn) {
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { vreal t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        size_t half = len >> 1, stride = tn / len;
        for (size_t i = 0; i < n; i += len) {
            for (size_t k = 0; k < half; k++) {
                vreal wr = tc[k * stride], wi = sign * ts[k * stride];
                size_t a = i + k, b = a + half;
                vreal xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr; im[b] = im[a] - xi;
                re[a] += xr; im[a] += xi;
            }
        }
    }
}

static void fft(vigil_ws *ws, vreal *re, vreal *im, int sign) {
    size_t n = ws->n;
    if (!ws->m) { radix2(re, im, n, sign, ws->wr, ws->wi, n); return; }
    size_t m = ws->m;
    const vreal *cr = chirp_r(ws), *ci = chirp_i(ws);
    vreal *ar = ws->ar, *ai = ws->ai;
    for (size_t k = 0; k < n; k++) {
        vreal wi = sign < 0 ? ci[k] : -ci[k];
        ar[k] = re[k] * cr[k] - im[k] * wi;
        ai[k] = re[k] * wi + im[k] * cr[k];
    }
    memset(ar + n, 0, (m - n) * sizeof(vreal)); memset(ai + n, 0, (m - n) * sizeof(vreal));
    radix2(ar, ai, m, -1, ws->wr, ws->wi, m);
    for (size_t k = 0; k < m; k++) {
        vreal bi = sign < 0 ? ws->bi[k] : -ws->bi[k];
        vreal xr = ar[k] * ws->br[k] - ai[k] * bi, xi = ar[k] * bi + ai[k] * ws->br[k];
        ar[k] = xr; ai[k] = xi;
    }
    radix2(ar, ai, m, 1, ws->wr, ws->wi, m);
    for (size_t k = 0; k < n; k++) {
        vreal wi = sign < 0 ? ci[k] : -ci[k];
        vreal xr = ar[k] / (vreal)m, xi = ai[k] / (vreal)m;
        re[k] = xr * cr[k] - xi * wi;
        im[k] = xr * wi + xi * cr[k];
    }
}

/* real input x (n) -> Xr, Xi (n/2 + 1) */
static void rfft(vigil_ws *ws, const vreal *x, vreal *Xr, vreal *Xi) {
    size_t n = ws->n, h = n / 2 + 1;
    for (size_t k = 0; k < n; k++) { ws->re[k] = x[k]; ws->im[k] = 0; }
    fft(ws, ws->re, ws->im, -1);
    for (size_t k = 0; k < h; k++) { Xr[k] = ws->re[k]; Xi[k] = ws->im[k]; }
}

/* numpy.fft.irfft: imaginary parts of DC and an even n's Nyquist bin are ignored */
static void irfft(vigil_ws *ws, const vreal *Xr, const vreal *Xi, vreal *out) {
    size_t n = ws->n, h = n / 2 + 1;
    vreal *re = ws->re, *im = ws->im;
    re[0] = Xr[0]; im[0] = 0;
    for (size_t k = 1; k < h; k++) {
        re[k] = Xr[k]; im[k] = Xi[k];
        if (n - k != k) { re[n - k] = Xr[k]; im[n - k] = -Xi[k]; }
    }
    if (n % 2 == 0) im[n / 2] = 0;
    fft(ws, re, im, 1);
    for (size_t k = 0; k < n; k++) out[k] = re[k] / (vreal)n;
}

/* numpy.fft.rfftfreq: k * (1 / (n * (1 / fs))), the same arithmetic so a bin
   that sits exactly on a band edge falls on the same side */
static double bin_hz(size_t n, double fs) { return 1.0 / ((double)n * (1.0 / fs)); }

static int cmp_vreal(const void *a, const void *b) {
    vreal x = *(const vreal *)a, y = *(const vreal *)b;
    return (x > y) - (x < y);
}
static double median(vreal *a, size_t n) {
    qsort(a, n, sizeof(vreal), cmp_vreal);
    return n % 2 ? (double)a[n / 2] : ((double)a[n / 2 - 1] + (double)a[n / 2]) / 2.0;
}

/* ---- the method ---- */
static void prewhiten(vigil_ws *ws, const vreal *x) {
    size_t n = ws->n, h = n / 2 + 1;
    double s = 0;
    for (size_t k = 0; k < n; k++) s += x[k];
    vreal mu = (vreal)(s / n);
    for (size_t k = 0; k < n; k++) ws->tmp[k] = x[k] - mu;
    rfft(ws, ws->tmp, ws->Xr, ws->Xi);
    for (size_t k = 0; k < h; k++) {
        vreal a = (vreal)(hypot((double)ws->Xr[k], (double)ws->Xi[k]) + 1e-12);
        ws->Xr[k] /= a; ws->Xi[k] /= a;
    }
    irfft(ws, ws->Xr, ws->Xi, ws->xw);
}

/* squared envelope of band [lo, hi) of the spectrum in Xr/Xi, into e2 */
static void band_envelope2(vigil_ws *ws, double fs, double lo, double hi) {
    size_t n = ws->n, h = n / 2 + 1;
    double v = bin_hz(n, fs);
    memset(ws->re, 0, n * sizeof(vreal)); memset(ws->im, 0, n * sizeof(vreal));
    for (size_t k = 0; k < h; k++) {
        double f = k * v;
        if (f >= lo && f < hi) { ws->re[k] = 2 * ws->Xr[k]; ws->im[k] = 2 * ws->Xi[k]; }
    }
    fft(ws, ws->re, ws->im, 1);
    double nn = (double)n * (double)n;
    for (size_t k = 0; k < n; k++) ws->e2[k] = (vreal)(((double)ws->re[k] * ws->re[k] + (double)ws->im[k] * ws->im[k]) / nn);
}

static void best_band(vigil_ws *ws, double fs, double *blo, double *bhi) {
    static const double widths[4] = {3000, 2000, 1500, 1000};
    size_t n = ws->n;
    double fmax = fs * 0.45 < 6000 ? fs * 0.45 : 6000;
    double best = -INFINITY;
    *blo = 0; *bhi = fmax;
    rfft(ws, ws->xw, ws->Xr, ws->Xi);
    for (int w = 0; w < 4; w++) {
        double bw = widths[w], stop = fmax - bw + 1e-9;
        for (int i = 0;; i++) {
            double lo = 200.0 + i * (bw / 4);
            if (lo >= stop) break;
            band_envelope2(ws, fs, lo, lo + bw);
            double s1 = 0, s2 = 0;
            for (size_t k = 0; k < n; k++) { s1 += ws->e2[k]; s2 += (double)ws->e2[k] * ws->e2[k]; }
            double kurt = (s2 / n) / ((s1 / n) * (s1 / n)) - 2;
            if (kurt > best) { best = kurt; *blo = lo; *bhi = lo + bw; }
        }
    }
}

static void squared_envelope_spectrum(vigil_ws *ws, double fs, double lo, double hi) {
    size_t n = ws->n, h = n / 2 + 1;
    band_envelope2(ws, fs, lo, hi);          /* Xr/Xi still hold rfft(xw) from best_band */
    double s = 0;
    for (size_t k = 0; k < n; k++) s += ws->e2[k];
    double mu = s / n;
    for (size_t k = 0; k < n; k++)
        ws->tmp[k] = (vreal)(((double)ws->e2[k] - mu) * (0.5 - 0.5 * cos(2 * M_PI * k / (double)(n - 1))));
    /* rfft into S (magnitude) without disturbing Xr/Xi */
    for (size_t k = 0; k < n; k++) { ws->re[k] = ws->tmp[k]; ws->im[k] = 0; }
    fft(ws, ws->re, ws->im, -1);
    double v = bin_hz(n, fs);
    for (size_t k = 0; k < h; k++) {
        ws->S[k] = (vreal)(hypot((double)ws->re[k], (double)ws->im[k]) / n);
        ws->fr[k] = (vreal)(k * v);
    }
}

static double line_snr_db(vigil_ws *ws, double fs, double f0, double tol, const int *harm, int nh) {
    size_t h = ws->n / 2 + 1;
    double v = bin_hz(ws->n, fs), total = 0;
    int used = 0;
    for (int j = 0; j < nh; j++) {
        double c = harm[j] * f0, peak = -INFINITY;
        size_t nref = 0;
        int any = 0;
        /* only the bins inside +-20% can matter; start there */
        size_t k0 = (size_t)fmax(0, floor(c * 0.8 / v) - 1);
        for (size_t k = k0; k < h; k++) {
            double f = k * v;
            if (f > c * 1.2) break;
            int in_win = f >= c * (1 - tol) && f <= c * (1 + tol);
            if (in_win) { any = 1; if (ws->S[k] > peak) peak = ws->S[k]; }
            else if (f >= c * 0.8 && f <= c * 1.2) ws->tmp[nref++] = ws->S[k];
        }
        if (!any || !nref) continue;
        total += 20 * log10(peak / (median(ws->tmp, nref) + 1e-18));
        used++;
    }
    return used ? total / used : 0;
}

static void diagnose_xw(vigil_ws *ws, double fs, double shaft_hz, const vigil_orders *o, double threshold_db, vigil_result *r) {
    static const int h123[3] = {1, 2, 3}, h24[2] = {2, 4};
    best_band(ws, fs, &r->band_lo, &r->band_hi);
    squared_envelope_spectrum(ws, fs, r->band_lo, r->band_hi);
    r->scores[VIGIL_BPFO] = line_snr_db(ws, fs, o->bpfo * shaft_hz, 0.02, h123, 3);
    r->scores[VIGIL_BPFI] = line_snr_db(ws, fs, o->bpfi * shaft_hz, 0.02, h123, 3);
    r->scores[VIGIL_BSF] = line_snr_db(ws, fs, o->bsf * shaft_hz, 0.02, h24, 2);   /* a ball strikes both races */
    int top = 0;
    for (int k = 1; k < 3; k++) if (r->scores[k] > r->scores[top]) top = k;
    r->verdict = r->scores[top] >= threshold_db ? top : VIGIL_NONE;
}

void vigil_diagnose(vigil_ws *ws, const vreal *x, double fs, double shaft_hz, const vigil_orders *o,
                    double threshold_db, vigil_result *out) {
    prewhiten(ws, x);
    diagnose_xw(ws, fs, shaft_hz, o, threshold_db, out);
}

vigil_orders vigil_bearing_orders(double rollers, double roller_dia, double pitch_dia, double contact_deg) {
    double r = roller_dia / pitch_dia * cos(contact_deg * M_PI / 180);
    vigil_orders o = {rollers / 2 * (1 - r), rollers / 2 * (1 + r), pitch_dia / (2 * roller_dia) * (1 - r * r), 0.5 * (1 - r)};
    return o;
}

void vigil_features(vigil_ws *ws, const vreal *x, double fs, double shaft_hz, const vigil_orders *o,
                    double f[VIGIL_NFEAT]) {
    size_t n = ws->n;
    double s = 0, s2 = 0, s4 = 0, pk = 0;
    for (size_t k = 0; k < n; k++) s += x[k];
    double mu = s / n;
    for (size_t k = 0; k < n; k++) {
        double d = x[k] - mu, d2 = d * d;
        s2 += d2; s4 += d2 * d2;
        if (fabs(d) > pk) pk = fabs(d);
    }
    double rms = sqrt(s2 / n);
    f[0] = log(rms);
    f[1] = (s4 / n) / (rms * rms * rms * rms);
    f[2] = pk / rms;
    vigil_result r;
    vigil_diagnose(ws, x, fs, shaft_hz, o, INFINITY, &r);   /* prewhitening removes the mean itself */
    f[3] = r.scores[VIGIL_BPFO]; f[4] = r.scores[VIGIL_BPFI]; f[5] = r.scores[VIGIL_BSF];
}

/* ---- the machine's own normal, and the alarm ---- */
static int cmp_double(const void *a, const void *b) {
    double x = *(const double *)a, y = *(const double *)b;
    return (x > y) - (x < y);
}
static double median_d(double *a, int n) {
    qsort(a, (size_t)n, sizeof(double), cmp_double);
    return n % 2 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2.0;
}

void vigil_learn(vigil_state *st, const double *rows, int n_base) {
    double *col = (double *)malloc((size_t)n_base * sizeof(double));
    memset(st, 0, sizeof *st);
    for (int j = 0; j < VIGIL_NFEAT; j++) {
        for (int i = 0; i < n_base; i++) col[i] = rows[i * VIGIL_NFEAT + j];
        double m = median_d(col, n_base);
        for (int i = 0; i < n_base; i++) col[i] = fabs(rows[i * VIGIL_NFEAT + j] - m);
        double mad = 1.4826 * median_d(col, n_base);
        st->med[j] = m;
        st->mad[j] = mad > VIGIL_FLOOR[j] ? mad : VIGIL_FLOOR[j];
    }
    free(col);
    st->base_level = exp(st->med[0]);
    st->named = VIGIL_NONE;
    st->named_line = -2;   /* no reading yet */
}

double vigil_watch(vigil_state *st, const double f[VIGIL_NFEAT]) {
    double hi = 0;
    for (int j = 0; j < VIGIL_NFEAT; j++) {
        double z = fabs(f[j] - st->med[j]) / st->mad[j];
        if (z > hi) hi = z;
    }
    int top = 0;
    for (int k = 1; k < 3; k++) if (f[3 + k] > f[3 + top]) top = k;
    int first = st->named_line == -2;
    int same = first || top == st->named_line;
    st->named_line = top;
    /* a stopped machine tells nothing about its health: under 30% of its normal level */
    if (exp(f[0]) < 0.3 * st->base_level) { st->named_run = 0; return -1; }
    st->over = hi >= 6 ? st->over + 1 : 0;
    if (st->over >= 3) st->alarm = 1;
    int ok = f[3 + top] >= 10;
    st->named_run = ok ? (same ? st->named_run + 1 : 1) : 0;
    if (st->named_run >= 3 && st->named == VIGIL_NONE) st->named = top;
    return hi;
}

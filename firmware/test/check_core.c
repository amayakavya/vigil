/* Checks firmware/core against the Python reference, recording by recording.
   For each of the nine reference recordings: the whole recording (the path
   the analysis took) and its longest power-of-two head (the radix-2 path the
   node runs). Pass: same verdict, same band, every line score within TOL dB.
   Build twice: with -DVIGIL_DOUBLE to check the method, and without it to
   check single precision, which is what the ESP32-S3 computes in. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "../core/vigil.h"

#ifdef VIGIL_DOUBLE
#define TOL 0.001
#define PREC "double"
#else
#define TOL 0.05
#define PREC "float"
#endif

static const char *NAME[] = {"outer race", "inner race", "rolling element"};
static const char *nm(int v) { return v < 0 ? "declined" : NAME[v]; }

static int run(const char *id, const vreal *x, size_t n, double fs, double rpm, const vigil_orders *o,
               int want_v, double lo, double hi, const double want[3], double *worst) {
    size_t bytes = vigil_workspace_bytes(n);
    void *mem = malloc(bytes);
    vigil_ws ws;
    vigil_workspace_init(&ws, n, mem, bytes);
    vigil_result r;
    clock_t t0 = clock();
    vigil_diagnose(&ws, x, fs, rpm / 60, o, 10.0, &r);
    double ms = 1000.0 * (clock() - t0) / CLOCKS_PER_SEC;
    double d = 0;
    for (int k = 0; k < 3; k++) d = fmax(d, fabs(r.scores[k] - want[k]));
    if (d > *worst) *worst = d;
    int ok = r.verdict == want_v && fabs(r.band_lo - lo) < 1e-6 && fabs(r.band_hi - hi) < 1e-6 && d < TOL;
    printf("%s %-14s n=%-6zu %-16s (python %-16s) band %4.0f-%4.0f (python %4.0f-%4.0f) max line diff %.2e dB  %5.0f ms  %.0f KiB\n",
           ok ? "PASS" : "FAIL", id, n, nm(r.verdict), nm(want_v), r.band_lo, r.band_hi, lo, hi, d, ms, bytes / 1024.0);
    free(mem);
    return ok;
}

int main(int argc, char **argv) {
    const char *manifest = argc > 1 ? argv[1] : "samples.txt";
    const char *dir = argc > 2 ? argv[2] : "../../docs/data/samples";
    FILE *f = fopen(manifest, "r");
    if (!f) { perror(manifest); return 2; }
    char id[64];
    double fs, rpm, scale, bpfo, bpfi, bsf, lo, hi, s[3], plo, phi, ps[3];
    int n, v, pn, pv, pass = 0, total = 0;
    double worst = 0;
    printf("firmware/core in %s precision against analysis/vigil.py\n", PREC);
    while (fscanf(f, "%63s %lf %lf %d %lf %lf %lf %lf %d %lf %lf %lf %lf %lf %d %d %lf %lf %lf %lf %lf",
                  id, &fs, &rpm, &n, &scale, &bpfo, &bpfi, &bsf, &v, &lo, &hi, &s[0], &s[1], &s[2],
                  &pn, &pv, &plo, &phi, &ps[0], &ps[1], &ps[2]) == 21) {
        char path[512];
        snprintf(path, sizeof path, "%s/%s.i16", dir, id);
        FILE *g = fopen(path, "rb");
        if (!g) { perror(path); return 2; }
        short *q = malloc((size_t)n * sizeof(short));
        if (fread(q, sizeof(short), (size_t)n, g) != (size_t)n) { fprintf(stderr, "short read %s\n", path); return 2; }
        fclose(g);
        vreal *x = malloc((size_t)n * sizeof(vreal));
        for (int i = 0; i < n; i++) x[i] = (vreal)(q[i] * scale);
        vigil_orders o = {bpfo, bpfi, bsf, 0};
        pass += run(id, x, (size_t)n, fs, rpm, &o, v, lo, hi, s, &worst); total++;
        pass += run(id, x, (size_t)pn, fs, rpm, &o, pv, plo, phi, ps, &worst); total++;
        free(q); free(x);
    }
    fclose(f);
    printf("%d of %d match the Python reference in %s; worst line-score difference %.2e dB (allowed %.3f)\n",
           pass, total, PREC, worst, TOL);
    return pass == total ? 0 : 1;
}

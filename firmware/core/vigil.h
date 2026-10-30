/* VIGIL signal core, portable C99. The same steps as analysis/vigil.py and
   docs/vigil.js, so the node, the page and the analysis cannot disagree:
   firmware/test checks this file against the Python reference.

   Built in float by default, for the ESP32-S3's single-precision FPU. Sums
   over a whole snapshot are kept in double, because a float accumulator over
   32,768 squared samples loses the digits the kurtosis depends on. Define
   VIGIL_DOUBLE to build every array in double, for checking. */
#ifndef VIGIL_H
#define VIGIL_H
#include <stddef.h>

#ifdef VIGIL_DOUBLE
typedef double vreal;
#else
typedef float vreal;
#endif

enum { VIGIL_NONE = -1, VIGIL_BPFO = 0, VIGIL_BPFI = 1, VIGIL_BSF = 2 };
#define VIGIL_NFEAT 6   /* log RMS, kurtosis, crest factor, outer, inner and rolling-element line dB */

typedef struct { double bpfo, bpfi, bsf, ftf; } vigil_orders;

typedef struct {
    int verdict;              /* VIGIL_BPFO, VIGIL_BPFI, VIGIL_BSF or VIGIL_NONE (declined) */
    double scores[3];         /* line prominence, dB above its neighbourhood */
    double band_lo, band_hi;  /* the band the impacts ring in, Hz */
} vigil_result;

/* Working memory for one snapshot of n samples. vigil_workspace_bytes(n)
   says how much; the node takes it from PSRAM once and reuses it. */
typedef struct {
    size_t n, m;              /* m: Bluestein length, 0 when n is a power of two */
    vreal *xw, *re, *im, *e2, *Xr, *Xi, *S, *fr, *tmp;
    vreal *br, *bi, *ar, *ai, *wr, *wi;  /* Bluestein only */
} vigil_ws;

size_t vigil_workspace_bytes(size_t n);
int vigil_workspace_init(vigil_ws *ws, size_t n, void *mem, size_t bytes);

vigil_orders vigil_bearing_orders(double rollers, double roller_dia, double pitch_dia, double contact_deg);

/* Name the failing part, or decline. threshold_db is 10 in every result VIGIL publishes. */
void vigil_diagnose(vigil_ws *ws, const vreal *x, double fs, double shaft_hz, const vigil_orders *o,
                    double threshold_db, vigil_result *out);

/* The six health-index readings for one snapshot (features[0..5]). */
void vigil_features(vigil_ws *ws, const vreal *x, double fs, double shaft_hz, const vigil_orders *o,
                    double features[VIGIL_NFEAT]);

/* ---- the machine's own normal, and the alarm ---- */
typedef struct {
    double med[VIGIL_NFEAT], mad[VIGIL_NFEAT];  /* learned from the first day */
    double base_level;                          /* exp of the median log RMS: the running gate's reference */
    int over;                                   /* readings in a row at or above the alarm */
    int alarm;                                  /* latched until a mechanic clears it */
    int named_line, named_run, named;           /* naming: the same line on top, 10 dB clear, 3 in a row */
} vigil_state;

extern const double VIGIL_FLOOR[VIGIL_NFEAT];

/* Learn the normal from n_base feature rows (row-major, n_base x 6). */
void vigil_learn(vigil_state *st, const double *rows, int n_base);

/* Score one snapshot. Returns the health index, or -1 when the machine was
   stopped and the reading is ignored. Updates the alarm and the name. */
double vigil_watch(vigil_state *st, const double f[VIGIL_NFEAT]);

#endif

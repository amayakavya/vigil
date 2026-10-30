/* One NASA IMS bearing through the firmware, start to finish: the six
   readings from every snapshot (in the node's single precision), the first
   day learned with vigil_learn, every later snapshot scored with vigil_watch.
   Prints when the alarm latched and when a part was named, as snapshot
   indices, and writes the readings for comparison with the analysis.

   usage: replay_ims <list of snapshot files> <column> <n_base> <features out> */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../core/vigil.h"

#define N 20480
#define FS 20480.0

static int read_column(const char *path, int col, vreal *x) {
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    static char line[512];
    int i = 0;
    while (i < N && fgets(line, sizeof line, f)) {
        char *p = line, *end;
        double v = 0;
        for (int c = 0; c <= col; c++) {
            v = strtod(p, &end);
            if (end == p) { fclose(f); return -2; }
            p = end;
        }
        x[i++] = (vreal)v;
    }
    fclose(f);
    return i == N ? 0 : -3;
}

int main(int argc, char **argv) {
    if (argc < 5) { fprintf(stderr, "usage: %s list column n_base out\n", argv[0]); return 2; }
    int col = atoi(argv[2]), n_base = atoi(argv[3]);
    FILE *lst = fopen(argv[1], "r");
    if (!lst) { perror(argv[1]); return 2; }
    char (*paths)[512] = malloc(8000 * sizeof *paths);
    int count = 0;
    while (count < 8000 && fgets(paths[count], 512, lst)) { paths[count][strcspn(paths[count], "\n")] = 0; count++; }
    fclose(lst);

    size_t bytes = vigil_workspace_bytes(N);
    void *mem = malloc(bytes);
    vigil_ws ws;
    vigil_workspace_init(&ws, N, mem, bytes);
    vreal *x = malloc(N * sizeof(vreal));
    double *F = malloc((size_t)count * VIGIL_NFEAT * sizeof(double));
    vigil_orders o = vigil_bearing_orders(16, 0.331, 2.815, 15.17);   /* Rexnord ZA-2115 */
    for (int i = 0; i < count; i++) {
        if (read_column(paths[i], col, x)) { fprintf(stderr, "cannot read %s\n", paths[i]); return 2; }
        vigil_features(&ws, x, FS, 2000.0 / 60, &o, F + (size_t)i * VIGIL_NFEAT);
    }
    FILE *out = fopen(argv[4], "wb");
    fwrite(F, sizeof(double), (size_t)count * VIGIL_NFEAT, out);
    fclose(out);

    vigil_state st;
    vigil_learn(&st, F, n_base);
    int alarm_at = -1, named_at = -1, named_as = -1;
    for (int i = n_base; i < count; i++) {
        int before_alarm = st.alarm, before_named = st.named;
        vigil_watch(&st, F + (size_t)i * VIGIL_NFEAT);
        if (!before_alarm && st.alarm) alarm_at = i - 2;          /* the first of the three readings */
        if (before_named == VIGIL_NONE && st.named != VIGIL_NONE) { named_at = i - 2; named_as = st.named; }
    }
    printf("{\"snapshots\": %d, \"alarm_idx\": %d, \"named_idx\": %d, \"named_as\": %d}\n", count, alarm_at, named_at, named_as);
    free(F); free(x); free(mem); free(paths);
    return 0;
}

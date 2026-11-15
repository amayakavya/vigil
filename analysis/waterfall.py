"""The envelope spectrum of every bearing across its whole test, for the
console's waterfall display.

Each column is one real snapshot: the squared envelope spectrum VIGIL's method
computes for it (prewhitened, in the band the method chose for that snapshot),
from 0 to 600 Hz, in decibels above that spectrum's own median. A defect shows
as a line that appears at the frequency the bearing's geometry predicts and
stays. 240 columns a test, taken at even steps of test time. A step with no
snapshot near it (the rig was stopped) is left empty.

Writes docs/data/waterfall-<run>.bin (bearing, column, bin as uint8) and
docs/data/waterfall.json. About five minutes on a laptop."""
import json, os
from multiprocessing import Pool
import numpy as np
from vigil import prewhiten, best_band, squared_envelope_spectrum
from ims import ROOT, OUT, RUNS, FS, stamp

COLS, BINS, F_MAX, DB_MAX = 240, 160, 600.0, 30.0


def column(args):
    path, cols = args
    x = np.loadtxt(path)
    out = np.zeros((len(cols), BINS), np.uint8)
    for j, c in enumerate(cols):
        xw = prewhiten(x[:, c])
        _, lo, hi = best_band(xw, FS)
        fr, S = squared_envelope_spectrum(xw, FS, (lo, hi))
        keep = (fr >= 20) & (fr < F_MAX)
        db = 20 * np.log10(S / (np.median(S[keep]) + 1e-18) + 1e-12)
        edges = np.linspace(0, F_MAX, BINS + 1)
        idx = np.clip(np.searchsorted(edges, fr, side="right") - 1, 0, BINS - 1)
        m = np.full(BINS, -np.inf)
        np.maximum.at(m, idx[fr < F_MAX], db[fr < F_MAX])       # the strongest line in each bin
        out[j] = np.clip(m / DB_MAX, 0, 1) * 254
    return out


if __name__ == "__main__":
    meta = {"columns": COLS, "bins": BINS, "f_max": F_MAX, "db_max": DB_MAX, "runs": {}}
    for rid, cfg in RUNS.items():
        d = os.path.join(ROOT, cfg["dir"])
        names = sorted(os.listdir(d))
        t = [stamp(n) for n in names]
        hours = np.array([(ti - t[0]).total_seconds() / 3600 for ti in t])
        step = hours[-1] / COLS
        centre = (np.arange(COLS) + 0.5) * step
        near = np.abs(hours[None, :] - centre[:, None]).argmin(axis=1)
        have = np.abs(hours[near] - centre) <= step / 2 + 1e-9    # else the rig was stopped across this step
        with Pool(6) as pool:
            got = pool.map(column, [(os.path.join(d, names[i]), cfg["cols"]) for i in near[have]], chunksize=4)
        W = np.full((4, COLS, BINS), 255, np.uint8)               # 255: no snapshot
        W[:, have, :] = np.stack(got, axis=1)
        W.tofile(os.path.join(OUT, f"waterfall-{rid}.bin"))
        meta["runs"][rid] = {"end_h": round(float(hours[-1]), 3), "snapshot_h": [round(float(hours[i]), 3) if ok else None for i, ok in zip(near, have)]}
        print(f"run {rid}: {int(have.sum())} of {COLS} columns from real snapshots")
    json.dump(meta, open(os.path.join(OUT, "waterfall.json"), "w"), separators=(",", ":"))

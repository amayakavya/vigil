"""A learned model for naming the failing part, held to the same standard as
everything else: trained on one dataset, tested on another it has never seen.

Inputs are geometry-relative, so a model trained on one bearing can be asked
about another: the prominence (dB above the local median) of each defect
line's harmonics, of the sidebands that modulate them (inner race by the
shaft, rolling element by the cage), of the shaft lines, and how impulsive
the chosen band is. No absolute frequency, level or file property goes in.

Training: Case Western's 52 seeded-fault recordings, cut into one-second
pieces, grouped by recording so no recording is ever on both sides.
Held-out test: NASA's four failed bearings, every running snapshot in the
last 72 hours before each rig stopped. Different bearing, rig, sensor and
sampling rate. The physics rule is scored on exactly the same snapshots.

The model is multinomial logistic regression in numpy. It is small enough
to run on the node, and every weight can be read."""
import json, os, sys
from multiprocessing import Pool
import numpy as np
from vigil import CWRU_6205, IMS_ZA2115, prewhiten, best_band, squared_envelope_spectrum, line_snr_db, running
from cwru import FILES, load as cwru_load, NOMINAL_RPM

CLASSES = ["BPFO", "BPFI", "BSF"]
FEATURES = ["outer h1", "outer h2", "outer h3", "inner h1", "inner h2", "inner h3", "inner +-shaft",
            "ball 2x", "ball 4x", "ball 2x +-cage", "shaft 1x", "shaft 2x", "band kurtosis"]


def features(x, fs, shaft, o):
    xw = prewhiten(x)
    k, lo, hi = best_band(xw, fs)
    fr, S = squared_envelope_spectrum(xw, fs, (lo, hi))
    L = lambda f0, h=(1,): line_snr_db(fr, S, f0, harmonics=h)
    bo, bi, bs, ft = o["BPFO"] * shaft, o["BPFI"] * shaft, o["BSF"] * shaft, o["FTF"] * shaft
    return [L(bo), L(bo, (2,)), L(bo, (3,)), L(bi), L(bi, (2,)), L(bi, (3,)),
            (L(bi - shaft) + L(bi + shaft)) / 2,
            L(2 * bs), L(2 * bs, (2,)), (L(2 * bs - ft) + L(2 * bs + ft)) / 2,
            L(shaft), L(shaft, (2,)), float(np.log1p(max(k, 0)))]


def cwru_job(args):
    fid, lab = args
    x, rpm = cwru_load(fid)
    rpm = rpm or NOMINAL_RPM[FILES[fid][2]]
    o = dict(CWRU_6205)
    seg = 12000
    return [(fid, lab, features(x[i:i + seg], 12000, rpm / 60, o)) for i in range(0, len(x) - seg + 1, seg)]


IMS = os.path.expanduser("~/vigil-data/ims/4. Bearings")
RUNDIR = {"1": ("1st_test", [0, 2, 4, 6]), "2": ("2nd_test", [0, 1, 2, 3]), "3": ("4th_test/txt", [0, 1, 2, 3])}


def ims_job(args):
    path, col = args
    x = np.loadtxt(path)[:, col]
    return features(x, 20480, 2000 / 60, IMS_ZA2115)


def fit(X, y, l2=1.0, iters=3000, lr=0.1):
    """multinomial logistic regression, full-batch gradient descent, L2 on weights"""
    n, d = X.shape
    W, b = np.zeros((d, 3)), np.zeros(3)
    Y = np.eye(3)[y]
    for _ in range(iters):
        Z = X @ W + b
        Z -= Z.max(1, keepdims=True)
        P = np.exp(Z); P /= P.sum(1, keepdims=True)
        G = P - Y
        W -= lr * (X.T @ G / n + l2 * W / n)
        b -= lr * G.mean(0)
    return W, b


def predict(W, b, X):
    Z = X @ W + b
    Z -= Z.max(1, keepdims=True)
    P = np.exp(Z)
    return P / P.sum(1, keepdims=True)


def main():
    cache = os.path.expanduser("~/vigil-data/learn_cache.npz")
    ims = json.load(open(os.path.join(os.path.dirname(__file__), "..", "docs", "data", "ims.json")))
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        cw_rows, ims_X, ims_meta = list(z["cw_rows"]), z["ims_X"], list(z["ims_meta"])
    else:
        with Pool(8) as p:
            cw_rows = [r for chunk in p.map(cwru_job, [(f, v[0]) for f, v in sorted(FILES.items())]) for r in chunk]
            jobs, ims_meta = [], []
            for run, (d, cols) in RUNDIR.items():
                names = sorted(os.listdir(os.path.join(IMS, d)))
                h = np.array(ims[run]["hours"])
                F = np.load(os.path.expanduser(f"~/vigil-data/ims_run{run}_features.npy"))
                for b, v in ims[run]["bearings"].items():
                    if not v["failed"]:
                        continue
                    on = running(F[:, int(b) - 1, :], ims[run]["n_base"])
                    for i in np.where((h >= h[-1] - 72) & on)[0]:
                        jobs.append((os.path.join(IMS, d, names[i]), cols[int(b) - 1]))
                        ims_meta.append((run, b, v["failed"], int(i)))
            ims_X = np.array(p.map(ims_job, jobs, chunksize=8))
        np.savez(cache, cw_rows=np.array(cw_rows, dtype=object), ims_X=ims_X, ims_meta=np.array(ims_meta, dtype=object))
    Xc = np.array([r[2] for r in cw_rows], float)
    yc = np.array([CLASSES.index(r[1]) for r in cw_rows])
    gc = np.array([r[0] for r in cw_rows])
    yi = np.array([CLASSES.index(m[2]) for m in ims_meta])
    print(f"training pieces {len(Xc)} from {len(set(gc))} recordings, held-out NASA snapshots {len(ims_X)}")
    return Xc, yc, gc, np.asarray(ims_X, float), yi, ims_meta


def evaluate():
    """Every setting tried, all written down, so the headline cannot be a
    setting picked after seeing the test. The headline uses the middle
    settings (L2 1, confidence 0.9), fixed before any NASA score was read."""
    Xc, yc, gc, Xi, yi, meta = main()
    def physics(X):
        sc = np.stack([X[:, 0:3].mean(1), X[:, 3:6].mean(1), X[:, 7:9].mean(1)], 1)
        return np.where(sc.max(1) >= 10, sc.argmax(1), -1)
    def tally(pred):
        named = pred >= 0; right = (pred == yi) & named
        return {"named": int(named.sum()), "right": int(right.sum()), "wrong": int((named & ~right).sum()),
                "by_part": {CLASSES[c]: {"right": int(right[yi == c].sum()), "of": int((yi == c).sum())} for c in range(3)}}
    ph = physics(Xi)
    out = {"held_out": "NASA IMS, last 72 h of the four failed bearings, every running snapshot",
           "snapshots": int(len(yi)), "physics": tally(ph), "grid": []}
    mu, sd = Xc.mean(0), Xc.std(0) + 1e-9
    for l2 in (0.1, 1, 10, 100):
        ok = 0
        for g in np.unique(gc):                       # leave one Case Western recording out
            tr = gc != g; m2, s2 = Xc[tr].mean(0), Xc[tr].std(0) + 1e-9
            W, b = fit((Xc[tr] - m2) / s2, yc[tr], l2=l2, iters=1500)
            P = predict(W, b, (Xc[~tr] - m2) / s2).mean(0)
            ok += int(P.max() >= 0.6 and P.argmax() == yc[~tr][0])
        W, b = fit((Xc - mu) / sd, yc, l2=l2, iters=3000)
        P = predict(W, b, (Xi - mu) / sd)
        for tau in (0.5, 0.7, 0.8, 0.9, 0.95):
            alone = np.where(P.max(1) >= tau, P.argmax(1), -1)
            out["grid"].append({"l2": l2, "confidence": tau, "cwru_recordings_right": ok,
                                "model_alone": tally(alone), "physics_then_model": tally(np.where(ph >= 0, ph, alone))})
    out["headline"] = next(g for g in out["grid"] if g["l2"] == 1 and g["confidence"] == 0.9)
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "..", "docs", "data", "learned.json"), "w"), indent=1)
    h = out["headline"]
    print(f"physics {out['physics']['right']} right, {out['physics']['wrong']} wrong | model (L2 1, 0.9) "
          f"{h['model_alone']['right']} right, {h['model_alone']['wrong']} wrong | Case Western {h['cwru_recordings_right']}/52")


if __name__ == "__main__":
    evaluate()

"""Runs all twelve NASA IMS bearings through the firmware (replay_ims.c) and
checks it against the analysis (docs/data/ims.json and the cached readings).

Pass for each bearing: the alarm latches on the same snapshot, the part is
named on the same snapshot and as the same part, and no reading differs from
the analysis by more than a small fraction of the spread floor it is judged
against. Eight jobs at a time; about ten minutes on a laptop."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
DATA = os.path.expanduser("~/vigil-data")
IMS = os.path.join(DATA, "ims", "4. Bearings")
ims = json.load(open(os.path.join(ROOT, "docs", "data", "ims.json")))
RUNS = {"1": ("1st_test", [0, 2, 4, 6]), "2": ("2nd_test", [0, 1, 2, 3]), "3": ("4th_test/txt", [0, 1, 2, 3])}
PART = {-1: None, 0: "BPFO", 1: "BPFI", 2: "BSF"}
FLOOR = np.array([0.05, 0.10, 0.10, 1.0, 1.0, 1.0])
WORK = os.path.join(DATA, "fw-replay")
os.makedirs(WORK, exist_ok=True)

subprocess.run(["cc", "-std=c99", "-O2", "-o", os.path.join(WORK, "replay_ims"), os.path.join(HERE, "replay_ims.c"),
                os.path.join(HERE, "..", "core", "vigil.c"), "-lm"], check=True)

jobs = []
for run, (d, cols) in RUNS.items():
    names = sorted(os.listdir(os.path.join(IMS, d)))
    lst = os.path.join(WORK, f"run{run}.txt")
    open(lst, "w").write("\n".join(os.path.join(IMS, d, n) for n in names) + "\n")
    for b in range(4):
        jobs.append((run, b + 1, cols[b], lst))


def go(job):
    run, b, col, lst = job
    out = os.path.join(WORK, f"run{run}-b{b}.f64")
    r = subprocess.run([os.path.join(WORK, "replay_ims"), lst, str(col), str(ims[run]["n_base"]), out],
                       capture_output=True, text=True, check=True)
    return job, json.loads(r.stdout), out


ok_all, rows = True, []
with ThreadPoolExecutor(8) as pool:
    for (run, b, col, lst), res, out in pool.map(go, jobs):
        py = ims[run]["bearings"][str(b)]
        Fc = np.fromfile(out).reshape(-1, 6)
        Fp = np.load(os.path.join(DATA, f"ims_run{run}_features.npy"))[:, b - 1, :]
        rel = float((np.abs(Fc - Fp) / FLOOR).max())          # worst difference, in units of each reading's floor
        alarm_ok = res["alarm_idx"] == (py["alarm_idx"] if py["alarm_idx"] is not None else -1)
        named_ok = res["named_idx"] == py.get("named_idx", -1) and PART[res["named_as"]] == py.get("named_as")
        ok = alarm_ok and named_ok and rel < 0.05
        ok_all &= ok
        rows.append((run, b, res["snapshots"], ok, res["alarm_idx"], py["alarm_idx"], res["named_idx"], py.get("named_idx"),
                     PART[res["named_as"]], py.get("named_as"), rel))
total = 0
for run, b, n, ok, ca, pa, cn, pn, cpart, ppart, rel in sorted(rows):
    total += n
    print(f"{'PASS' if ok else 'FAIL'} run {run} bearing {b}: {n} snapshots, alarm at {ca} (analysis {pa}), "
          f"named at {cn} as {cpart} (analysis {pn} as {ppart}), worst reading difference {rel:.4f} of its floor")
print(f"{sum(r[3] for r in rows)} of {len(rows)} bearings, {total:,} snapshots: the firmware makes the analysis's decisions on the same snapshots")
json.dump({"bearings": len(rows), "passed": int(sum(r[3] for r in rows)), "snapshots": total,
           "worst_reading_difference_of_floor": round(max(r[10] for r in rows), 6),
           "rows": [{"run": r[0], "bearing": r[1], "snapshots": r[2], "pass": bool(r[3]), "alarm_idx": r[4], "named_idx": r[6],
                     "named_as": r[8]} for r in sorted(rows)]},
          open(os.path.join(HERE, "replay_result.json"), "w"), indent=1)
sys.exit(0 if ok_all else 1)

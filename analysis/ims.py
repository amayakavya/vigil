"""NASA / IMS run-to-failure data: how early does the system warn, and how often
does it cry wolf?

Each run is a shaft with four bearings, one 1-second snapshot every 10 minutes,
until a bearing fails. The system learns each bearing's first 24 hours as its
healthy baseline and is never shown a failure. Bearings that did not fail are
the false-alarm test.

Sampling rate is 20,480 Hz: measured, not assumed. With it the outer-race line
lands at 236.0 Hz against 236.4 Hz predicted from the bearing geometry; at the
20 kHz the readme also mentions, it lands 2.5% low.
"""
import json, os, sys
from datetime import datetime
from multiprocessing import Pool
import numpy as np
from vigil import IMS_ZA2115, FEATURE_NAMES, condition_features, diagnose, first_alarm, health_index, running

ROOT = os.path.expanduser("~/vigil-data/ims/4. Bearings")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
FS = 20480
SHAFT = 2000 / 60
BASE_HOURS = 24

RUNS = {
    # Test 1 has two accelerometers per bearing; the first of each pair is used.
    "1": {"dir": "1st_test", "cols": [0, 2, 4, 6], "failed": {3: "BPFI", 4: "BSF"}},
    "2": {"dir": "2nd_test", "cols": [0, 1, 2, 3], "failed": {1: "BPFO"}},
    "3": {"dir": "4th_test/txt", "cols": [0, 1, 2, 3], "failed": {3: "BPFO"}},
}


def stamp(name):
    return datetime.strptime(name, "%Y.%m.%d.%H.%M.%S")


def features(args):
    path, cols = args
    x = np.loadtxt(path)
    return [condition_features(x[:, c], FS, SHAFT, IMS_ZA2115) for c in cols]


def main(run_ids):
    results = {}
    for rid in run_ids:
        cfg = RUNS[rid]
        d = os.path.join(ROOT, cfg["dir"])
        names = sorted(os.listdir(d))
        t = [stamp(n) for n in names]
        hours = np.array([(ti - t[0]).total_seconds() / 3600 for ti in t])
        cache = os.path.expanduser(f"~/vigil-data/ims_run{rid}_features.npy")
        if os.path.exists(cache):
            F = np.load(cache)
        else:
            with Pool(8) as p:
                F = np.array(p.map(features, [(os.path.join(d, n), cfg["cols"]) for n in names], chunksize=8))
            np.save(cache, F)
        n_base = int(np.searchsorted(hours, BASE_HOURS))
        end = hours[-1]
        run = {"hours": [round(h, 3) for h in hours], "end_h": round(end, 2), "n_base": n_base,
               "start": t[0].isoformat(), "stop": t[-1].isoformat(), "bearings": {}}
        HZ = [health_index(F[:, b, :], n_base) for b in range(4)]
        HI = np.array([hz[0] for hz in HZ])
        for b in range(4):
            hi, Z = HZ[b]
            on = running(F[:, b, :], n_base)
            a = first_alarm(hi, n_base, on=on)
            info = {"failed": cfg["failed"].get(b + 1), "alarm_idx": a,
                    "alarm_h": round(hours[a], 2) if a is not None else None,
                    "lead_h": round(end - hours[a], 1) if a is not None else None,
                    "hi": [round(min(float(v), 99.0), 2) for v in hi],
                    "rms": [round(float(np.exp(v)), 5) for v in F[:, b, 0]]}
            # Name, once available: the outer, inner or ball line has been the
            # top line at 10 dB or more for three running snapshots in a row.
            named = None
            top = np.argmax(F[:, b, 3:6], axis=1)
            ok = (F[:, b, 3:6].max(axis=1) >= 10) & on
            streak = 0
            for i in range(n_base, len(hi)):
                streak = streak + 1 if ok[i] and (i == n_base or top[i] == top[i - 1]) else (1 if ok[i] else 0)
                if streak >= 3:
                    named = i - 2
                    break
            if named is not None:
                info["named_idx"] = named
                info["named_h"] = round(hours[named], 2)
                info["named_lead_h"] = round(end - hours[named], 1)
                line = int(top[named + 2])
                info["named_as"] = ["BPFO", "BPFI", "BSF"][line]
                # Identical bearings on one shaft share defect frequencies, so a
                # neighbour hears the failing bearing's line. It belongs to the
                # sensor where that line is strongest.
                info["named_loudest"] = int(np.argmax(F[named:named + 3, :, 3 + line].mean(axis=0))) + 1
            if a is not None:
                # Localisation: on one machine, the alarm belongs to the sensor
                # whose index is highest at that moment.
                loudest = int(np.argmax(HI[:, a])) + 1
                info["loudest_at_alarm"] = loudest
                info["alarm_driver"] = FEATURE_NAMES[int(np.argmax(Z[a]))]
                # Name the part from the alarm snapshot and the next five, as
                # the node would before it reports.
                x_names = names[a:a + 6]
                verdicts = []
                for n in x_names:
                    x = np.loadtxt(os.path.join(d, n))[:, cfg["cols"][b]]
                    verdicts.append(diagnose(x, FS, SHAFT, IMS_ZA2115)["verdict"])
                info["alarm_verdicts"] = verdicts
                # When does the name first become available, for the failed bearing?
            run["bearings"][str(b + 1)] = info
            print(f"run {rid} bearing {b + 1} failed={info['failed']} alarm_h={info['alarm_h']} "
                  f"lead_h={info['lead_h']} driver={info.get('alarm_driver')} loudest={info.get('loudest_at_alarm')} "
                  f"named={info.get('named_as')}@{info.get('named_h')}h lead={info.get('named_lead_h')} verdicts={info.get('alarm_verdicts')}")
        bs = run["bearings"]
        first = {b: min(x for x in (v["alarm_h"], v.get("named_h")) if x is not None)
                 for b, v in bs.items() if v["alarm_h"] is not None or v.get("named_h") is not None}
        failed = [b for b, v in bs.items() if v["failed"]]
        run["summary"] = {
            "failed": {b: {"part": bs[b]["failed"], "first_warning_lead_h": round(end - first[b], 1) if b in first else None,
                           "named_as": bs[b].get("named_as"), "named_lead_h": bs[b].get("named_lead_h")} for b in failed},
            "healthy_bearing_hours": round(end * (4 - len(failed)), 1),
            "healthy_alarms": sum(1 for b, v in bs.items() if not v["failed"] and b in first),
            "healthy_alarms_not_traced_to_failed": sum(
                1 for b, v in bs.items() if not v["failed"] and b in first and not (
                    (v["alarm_h"] is None or str(v.get("loudest_at_alarm")) in failed) and
                    (v.get("named_h") is None or str(v.get("named_loudest")) in failed))),
            "healthy_alarms_before_any_failed_warning": sum(
                1 for b, v in bs.items() if not v["failed"] and b in first and first[b] < min(first[f] for f in failed if f in first)),
        }
        print(json.dumps(run["summary"]))
        results[rid] = run
        print(f"run {rid}: {len(names)} snapshots, {end:.1f} h, baseline {n_base} snapshots")
    prev = {}
    out = os.path.join(OUT, "ims.json")
    if os.path.exists(out):
        prev = json.load(open(out))
    prev.update(results)
    json.dump(prev, open(out, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1:] or ["2"])

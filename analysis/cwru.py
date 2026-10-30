"""Case Western Reserve University bearing data: can the system name the part?

Naming only. CWRU's healthy recordings are five seconds per load, too short to
learn a baseline from or to measure false alarms on; that is done on the IMS
run-to-failure data instead (ims.py).

This set was used for development: after the first pass the band search was
capped at the node sensor's bandwidth, because it had been picking the
anti-alias edge at 5.6 to 6 kHz. Nothing else was changed after looking.
"""
import json, os, sys
import numpy as np
import scipy.io as sio
from scipy import signal
from vigil import CWRU_6205, diagnose

DATA = os.path.expanduser("~/vigil-data/cwru")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
FS = 12000
# 12 kHz drive-end files. Label, fault size (inch), load (hp).
FILES = {}
for ids, lab, size in [
    ((105, 106, 107, 108), "BPFI", 0.007), ((169, 170, 171, 172), "BPFI", 0.014), ((209, 210, 211, 212), "BPFI", 0.021),
    ((118, 119, 120, 121), "BSF", 0.007), ((185, 186, 187, 188), "BSF", 0.014), ((222, 223, 224, 225), "BSF", 0.021),
    ((130, 131, 132, 133), "BPFO", 0.007), ((197, 198, 199, 200), "BPFO", 0.014), ((234, 235, 236, 237), "BPFO", 0.021),
    ((144, 145, 146, 147), "BPFO", 0.007), ((246, 247, 248, 249), "BPFO", 0.021),
    ((156, 158, 159, 160), "BPFO", 0.007), ((258, 259, 260, 261), "BPFO", 0.021),
]:
    for load, i in enumerate(ids):
        FILES[i] = (lab, size, load)
POSITION = {**{i: "@6" for i in (130, 131, 132, 133, 197, 198, 199, 200, 234, 235, 236, 237)},
            **{i: "@3" for i in (144, 145, 146, 147, 246, 247, 248, 249)},
            **{i: "@12" for i in (156, 158, 159, 160, 258, 259, 260, 261)}}
NORMAL = {97: 0, 98: 1, 99: 2, 100: 3}  # 48 kHz recordings, decimated to 12 kHz
NOMINAL_RPM = {0: 1797, 1: 1772, 2: 1750, 3: 1730}  # CWRU test-rig speeds, for files with no RPM field


def load(i):
    d = sio.loadmat(os.path.join(DATA, f"{i}.mat"))
    key = next(k for k in d if k.endswith("_DE_time"))
    x = d[key].ravel().astype(float)
    rpm_key = next((k for k in d if k.endswith("RPM")), None)
    rpm = float(np.ravel(d[rpm_key])[0]) if rpm_key else None
    if i in NORMAL:
        x = signal.decimate(x, 4, ftype="fir", zero_phase=True)
    return x, rpm


def main():
    rpm_by_load = {}
    for i, load_hp in NORMAL.items():
        _, rpm = load(i)
        rpm_by_load[load_hp] = rpm or NOMINAL_RPM[load_hp]

    rows, examples = [], {}
    for i, (lab, size, load_hp) in sorted(FILES.items()):
        x, rpm = load(i)
        rpm = rpm or rpm_by_load[load_hp]
        # Naming uses the whole ten-second recording, as the node would by
        # averaging its one-second snapshots.
        d = diagnose(x, FS, rpm / 60, CWRU_6205)
        rows.append({
            "file": i, "truth": lab, "size_in": size, "load_hp": load_hp, "rpm": rpm,
            "position": POSITION.get(i, ""), "verdict": d["verdict"],
            "scores": {k: round(v, 1) for k, v in d["scores"].items()},
            "band_hz": [round(b) for b in d["band"]],
        })
        if i in (105, 130, 118):
            fr, S = d["fr"], d["S"]
            m = fr <= 600
            step = max(1, int(m.sum() / 900))
            examples[str(i)] = {
                "truth": lab, "rpm": rpm, "shaft_hz": rpm / 60,
                "lines": {k: CWRU_6205[k] * rpm / 60 for k in ("BPFO", "BPFI", "BSF")},
                "f": [round(v, 2) for v in fr[m][::step]],
                "s": [float(f"{v:.4g}") for v in (S[m] / S[m].max())[::step]],
                "verdict": d["verdict"], "scores": rows[-1]["scores"],
            }

    named = sum(r["verdict"] == r["truth"] for r in rows)
    wrong = sum(r["verdict"] is not None and r["verdict"] != r["truth"] for r in rows)
    unnamed = sum(r["verdict"] is None for r in rows)
    by = {}
    for r in rows:
        b = by.setdefault(r["truth"], {"n": 0, "named": 0, "wrong": 0, "unnamed": 0})
        b["n"] += 1
        b["named"] += r["verdict"] == r["truth"]
        b["wrong"] += r["verdict"] is not None and r["verdict"] != r["truth"]
        b["unnamed"] += r["verdict"] is None
    summary = {
        "files": len(rows), "named_correctly": named, "named_wrongly": wrong, "not_named": unnamed,
        "by_fault": by,
    }
    json.dump({"summary": summary, "rows": rows, "examples": examples},
              open(os.path.join(OUT, "cwru.json"), "w"), separators=(",", ":"))
    print(json.dumps(summary, indent=1))
    for r in rows:
        flag = "OK " if r["verdict"] == r["truth"] else ("-- " if r["verdict"] is None else "XX ")
        print(flag, r["file"], r["truth"], r["size_in"], r["position"], r["load_hp"], r["verdict"], r["scores"],
              r["band_hz"])


if __name__ == "__main__":
    main()

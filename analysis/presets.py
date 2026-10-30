"""Raw recordings for the in-browser diagnosis, and what the Python reference
says about each, so the page's JavaScript can be checked against it.

Snapshots are picked by rule, not by result: for run 2, bearing 1, the hours
the replay already shows (30, the first warning, 150), and for each failed
bearing the snapshot nearest 12 hours before its rig stopped. Whatever the
reference says about them is what the page must say too, including "declined".

Each recording is stored as little-endian int16 with one scale factor. The
reference runs on the de-quantised values, which are exactly what the browser
decodes, so the comparison is like for like.
"""
import json, os
import numpy as np
from vigil import CWRU_6205, IMS_ZA2115, diagnose
from cwru import load as cwru_load

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "data", "samples")
IMS = os.path.expanduser("~/vigil-data/ims/4. Bearings")
ims = json.load(open(os.path.join(HERE, "..", "docs", "data", "ims.json")))
RUNDIR = {"1": ("1st_test", [0, 2, 4, 6]), "2": ("2nd_test", [0, 1, 2, 3]), "3": ("4th_test/txt", [0, 1, 2, 3])}
PART = {"BPFO": "outer race", "BPFI": "inner race", "BSF": "rolling element", None: None}


def ims_snapshot(run, bearing, hour):
    d, cols = RUNDIR[run]
    names = sorted(os.listdir(os.path.join(IMS, d)))
    i = int(np.argmin(np.abs(np.array(ims[run]["hours"]) - hour)))
    x = np.loadtxt(os.path.join(IMS, d, names[i]))[:, cols[bearing - 1]]
    return x, ims[run]["hours"][i], names[i]


def quantise(x):
    x = x - x.mean()
    scale = float(np.abs(x).max()) / 32767
    q = np.round(x / scale).astype("<i2")
    return q, scale


os.makedirs(OUT, exist_ok=True)
items = []
r2 = ims["2"]
picks = [("2", 1, 30, "Run 2, bearing 1, hour 30 (healthy)"),
         ("2", 1, r2["bearings"]["1"]["named_h"], "Run 2, bearing 1, first warning"),
         ("2", 1, 150, "Run 2, bearing 1, hour 150")]
for run in ("1", "3"):
    for b, v in ims[run]["bearings"].items():
        if v["failed"]:
            picks.append((run, int(b), ims[run]["end_h"] - 12, f"Run {run}, bearing {b}, 12 h before the rig stopped"))
for run, b, hour, label in picks:
    x, h, name = ims_snapshot(run, b, hour)
    q, scale = quantise(x)
    sid = f"ims{run}-b{b}-{int(round(h))}h"
    q.tofile(os.path.join(OUT, sid + ".i16"))
    d = diagnose(q.astype(float) * scale, 20480, 2000 / 60, IMS_ZA2115)
    items.append({"id": sid, "label": label, "source": f"NASA IMS test {run}, file {name}, channel for bearing {b}",
                  "truth": ims[run]["bearings"][str(b)]["failed"], "fs": 20480, "rpm": 2000, "bearing": "ZA-2115",
                  "n": int(len(q)), "scale": scale,
                  "expect": {"verdict": d["verdict"], "band": [round(v, 3) for v in d["band"]],
                             "scores": {k: round(v, 4) for k, v in d["scores"].items()}}})
for fid, label in ((105, "Case Western 105: inner race, 0.18 mm, 0 hp"),
                   (130, "Case Western 130: outer race, 0.18 mm, 0 hp"),
                   (118, "Case Western 118: rolling element, 0.18 mm, 0 hp")):
    x, rpm = cwru_load(fid)
    q, scale = quantise(x)
    sid = f"cwru-{fid}"
    q.tofile(os.path.join(OUT, sid + ".i16"))
    d = diagnose(q.astype(float) * scale, 12000, rpm / 60, CWRU_6205)
    truth = {105: "BPFI", 130: "BPFO", 118: "BSF"}[fid]
    items.append({"id": sid, "label": label, "source": f"Case Western Reserve University Bearing Data Center, file {fid}.mat, drive end",
                  "truth": truth, "fs": 12000, "rpm": rpm, "bearing": "6205",
                  "n": int(len(q)), "scale": scale,
                  "expect": {"verdict": d["verdict"], "band": [round(v, 3) for v in d["band"]],
                             "scores": {k: round(v, 4) for k, v in d["scores"].items()}}})
json.dump({"bearings": {"ZA-2115": {"name": "Rexnord ZA-2115 (NASA IMS rig)", "orders": IMS_ZA2115,
                                     "geometry": {"rollers": 16, "roller_in": 0.331, "pitch_in": 2.815, "contact_deg": 15.17}},
                        "6205": {"name": "SKF 6205-2RS JEM (Case Western drive end)", "orders": CWRU_6205}},
           "samples": items}, open(os.path.join(OUT, "..", "samples.json"), "w"), indent=1)
# The node records a power-of-two snapshot, so the firmware is also checked on
# the longest power-of-two head of each recording, which takes the radix-2 path
# it will run on the board. One line per recording for the C test bench.
CODE = {"BPFO": 0, "BPFI": 1, "BSF": 2, None: -1}
lines = []
for it in items:
    q = np.fromfile(os.path.join(OUT, it["id"] + ".i16"), "<i2")
    x = q.astype(float) * it["scale"]
    P = 1 << (len(x).bit_length() - 1)
    o = IMS_ZA2115 if it["bearing"] == "ZA-2115" else CWRU_6205
    dp = diagnose(x[:P], it["fs"], it["rpm"] / 60, o)
    it["expect_pow2"] = {"n": P, "verdict": dp["verdict"], "band": [float(v) for v in dp["band"]],
                         "scores": {k: round(v, 4) for k, v in dp["scores"].items()}}
    e = it["expect"]
    lines.append(" ".join(str(v) for v in [
        it["id"], it["fs"], it["rpm"], it["n"], repr(it["scale"]), o["BPFO"], o["BPFI"], o["BSF"],
        CODE[e["verdict"]], e["band"][0], e["band"][1], e["scores"]["BPFO"], e["scores"]["BPFI"], e["scores"]["BSF"],
        P, CODE[dp["verdict"]], float(dp["band"][0]), float(dp["band"][1]),
        round(dp["scores"]["BPFO"], 4), round(dp["scores"]["BPFI"], 4), round(dp["scores"]["BSF"], 4)]))
json.dump({"bearings": {"ZA-2115": {"name": "Rexnord ZA-2115 (NASA IMS rig)", "orders": IMS_ZA2115,
                                     "geometry": {"rollers": 16, "roller_in": 0.331, "pitch_in": 2.815, "contact_deg": 15.17}},
                        "6205": {"name": "SKF 6205-2RS JEM (Case Western drive end)", "orders": CWRU_6205}},
           "samples": items}, open(os.path.join(OUT, "..", "samples.json"), "w"), indent=1)
open(os.path.join(HERE, "..", "firmware", "test", "samples.txt"), "w").write("\n".join(lines) + "\n")
for it in items:
    print(it["id"], it["n"], "truth", it["truth"], "->", it["expect"]["verdict"], "| head", it["expect_pow2"]["n"], "->", it["expect_pow2"]["verdict"])

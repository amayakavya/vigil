"""Compact data for the demo page and figures for the deck, from the outputs of
cwru.py and ims.py. Nothing here computes a result; it only reshapes them."""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from vigil import IMS_ZA2115, diagnose

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "docs", "data")
FIG = os.path.join(HERE, "..", "figures")
ROOT = os.path.expanduser("~/vigil-data/ims/4. Bearings/2nd_test")
FS, SHAFT = 20480, 2000 / 60

ims = json.load(open(os.path.join(SITE, "ims.json")))
cwru = json.load(open(os.path.join(SITE, "cwru.json")))


def pool(h, v, n=900):
    """Max-pool to at most n points so a spike survives the downsampling."""
    h, v = np.asarray(h), np.asarray(v)
    if len(h) <= n:
        return h.tolist(), v.tolist()
    edges = np.linspace(0, len(h), n + 1).astype(int)
    return ([round(float(h[a]), 2) for a, b in zip(edges[:-1], edges[1:])],
            [round(float(v[a:b].max()), 2) for a, b in zip(edges[:-1], edges[1:])])


replay = {}
for rid, run in ims.items():
    r = {"end_h": run["end_h"], "base_h": run["hours"][run["n_base"]], "start": run["start"],
         "summary": run["summary"], "bearings": {}}
    for b, info in run["bearings"].items():
        h, v = pool(run["hours"], info["hi"])
        r["bearings"][b] = {k: info.get(k) for k in ("failed", "alarm_h", "named_h", "named_as", "loudest_at_alarm",
                                                     "named_loudest", "alarm_driver")}
        r["bearings"][b]["h"], r["bearings"][b]["hi"] = h, v
    replay[rid] = r

# Envelope spectra for run 2, bearing 1: a healthy day, the first named
# warning, and late in the failure.
names = sorted(os.listdir(ROOT))
hours = ims["2"]["hours"]
named_idx = ims["2"]["bearings"]["1"]["named_h"]
picks = {"healthy": int(np.searchsorted(hours, 30)), "warning": int(np.searchsorted(hours, named_idx)),
         "late": int(np.searchsorted(hours, 150))}
spectra = {}
for tag, i in picks.items():
    x = np.loadtxt(os.path.join(ROOT, names[i]))[:, 0]
    d = diagnose(x, FS, SHAFT, IMS_ZA2115)
    m = d["fr"] <= 1000
    f, S = pool(d["fr"][m], d["S"][m] / d["S"][m][d["fr"][m] > 60].max(), n=800)
    spectra[tag] = {"h": round(hours[i], 1), "verdict": d["verdict"],
                    "scores": {k: round(v, 1) for k, v in d["scores"].items()},
                    "f": [round(v, 1) for v in f], "s": [float(f"{min(v, 1.5):.3g}") for v in S]}
replay["lines_hz"] = {k: round(v * SHAFT, 2) for k, v in IMS_ZA2115.items()}
replay["spectra"] = spectra
json.dump(replay, open(os.path.join(SITE, "replay.json"), "w"), separators=(",", ":"))
print("replay.json", os.path.getsize(os.path.join(SITE, "replay.json")) // 1024, "KB")

# Deck figures. Navy and orange are the template's own colours.
NAVY, ORANGE, GREY, INK = "#1f2a5c", "#f28c28", "#b9bfd3", "#20243a"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.edgecolor": "#8a90a8", "axes.labelcolor": INK,
                     "xtick.color": INK, "ytick.color": INK})

run = ims["2"]
fig, ax = plt.subplots(figsize=(7.2, 3.0), dpi=200)
for b in ("2", "3", "4"):
    ax.plot(run["hours"], np.minimum(run["bearings"][b]["hi"], 60), color=GREY, lw=0.9)
ax.plot(run["hours"], np.minimum(run["bearings"]["1"]["hi"], 60), color=NAVY, lw=1.4, label="Bearing 1 (failed)")
ax.plot([], [], color=GREY, lw=0.9, label="Bearings 2 to 4 (healthy)")
ax.axhline(6, color=ORANGE, lw=1, ls="--")
ax.text(2, 7.5, "alarm level", color=ORANGE, fontsize=9)
ax.axvspan(0, run["hours"][run["n_base"]], color="#eef0f7", zorder=0)
ax.text(1.5, 52, "learns its\nown normal", fontsize=9, color=INK, va="top")
lead = run["summary"]["failed"]["1"]["sustained_lead_h"]
w = run["end_h"] - lead
ax.axvline(w, color=ORANGE, lw=1.6)
ax.annotate(f"Warning holds from here, named outer race:\n{lead:.1f} h before the rig stopped",
            xy=(w, 9), xytext=(w - 62, 38), fontsize=9.5, color=INK,
            arrowprops=dict(arrowstyle="->", color=INK, lw=0.8))
ax.set_xlim(0, run["end_h"])
ax.set_ylim(0, 60)
ax.set_xlabel("Hours of running (NASA / IMS run-to-failure test 2)")
ax.set_ylabel("Health index")
ax.legend(loc="upper left", bbox_to_anchor=(0.13, 1.0), frameon=False, fontsize=9)
fig.tight_layout()
fig.savefig(os.path.join(FIG, "ims_run2.png"))

sp = spectra["late"]
fig, ax = plt.subplots(figsize=(4.6, 2.6), dpi=200)
ax.plot(sp["f"], np.minimum(sp["s"], 1), color=NAVY, lw=0.8)
for k, c in (("BPFO", ORANGE), ("BPFI", "#7a83a8"), ("BSF", "#a9b0cc")):
    f0 = replay["lines_hz"][k] * (2 if k == "BSF" else 1)
    ax.axvline(f0, color=c, lw=1, ls="--" if k != "BPFO" else "-", alpha=0.9)
ax.text(replay["lines_hz"]["BPFO"] + 8, 0.92, "outer race\n236.4 Hz", color=ORANGE, fontsize=9, va="top")
ax.text(replay["lines_hz"]["BPFO"] * 2 + 8, 0.6, "2x", color=ORANGE, fontsize=9)
ax.axvline(replay["lines_hz"]["BPFO"] * 2, color=ORANGE, lw=0.8, alpha=0.6)
ax.set_xlim(60, 800)
ax.set_ylim(0, 1.02)
ax.set_yticks([])
ax.set_xlabel("Envelope frequency (Hz)")
ax.set_title(f"Bearing 1 at hour {sp['h']}: the line the geometry predicts", fontsize=10, color=INK, loc="left")
fig.tight_layout()
fig.savefig(os.path.join(FIG, "ims_spectrum.png"))
print("figures written")

"""VIGIL's sheet: the drawing laid behind the page, in the house kit.

Every figure on it comes from the project: the ZA-2115 bearing row from the
geometry NASA's readme gives (16 rollers of 0.331 in on a 2.815 in pitch
circle, 15.17 degree contact), the defect lines computed from it at 2,000 rpm,
run 2's measured envelope spectrum and health index, and the lead times in
ims.json. Ring sections are drawn but not dimensioned, because the readme
does not give them.

out: ../docs/sheet.svg"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "analysis"))
from draft import Sheet
from vigil import IMS_ZA2115

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "docs", "data")
rep = json.load(open(os.path.join(DATA, "replay.json")))
ims = json.load(open(os.path.join(DATA, "ims.json")))

D = Sheet()
D.frame()

# ---- view A: one row of the bearing, to scale at 110 units to the inch ----
U = 110
cx, cy = 470, 400
rp, rr = 2.815 / 2 * U, 0.331 / 2 * U
D.circle(cx, cy, rp, "cen")                                   # pitch circle
D.circle(cx, cy, rp + rr + 1.5, "vis")                        # outer race
D.circle(cx, cy, rp + rr + 34, "vis")                         # outer ring, undimensioned
D.circle(cx, cy, rp - rr - 1.5, "vis")                        # inner race
D.circle(cx, cy, rp - rr - 30, "vis")                         # bore, undimensioned
for i in range(16):
    a = 2 * math.pi * i / 16 + math.pi / 16
    x, y = cx + rp * math.cos(a), cy + rp * math.sin(a)
    D.circle(x, y, rr, "vis")
    D.centre(x, y, rr, 3)
D.centre(cx, cy, rp - rr - 30, 14)
# the spall on the outer race at the load zone, where run 2's bearing 1 failed
sx = cx
sy = cy + rp + rr + 1.5
D.pl([(sx - 9, sy - 0.5), (sx - 5, sy + 4), (sx - 1, sy + 2.5), (sx + 3, sy + 5), (sx + 8, sy - 0.5)], "thick")
D.leader((sx + 4, sy + 4), (sx + 80, sy + 70), 30, "OUTER RACE SPALL")
D.leader((cx + rp * math.cos(-0.6), cy + rp * math.sin(-0.6)), (cx + 245, cy - 205), 30, "Ø2.815 PITCH")
a0 = 2 * math.pi * 2 / 16 + math.pi / 16
D.leader((cx + (rp + rr * .7) * math.cos(a0), cy + (rp + rr * .7) * math.sin(a0)), (cx + 250, cy + 150), 30, "16 × Ø0.331 ROLLERS")
D.text(cx, cy + 290, "VIEW A, ONE ROW OF TWO", 9)
D.text(cx, cy + 308, "REXNORD ZA-2115, NASA IMS RIG", 8)
D.text(cx, cy + 326, "CONTACT ANGLE 15.17°, SHAFT 2000 RPM", 8)

# ---- the defect lines, from the geometry ----
f = 2000 / 60
tx, ty = 880, 150
D.text(tx, ty, "DEFECT LINES AT 2000 RPM (33.33 HZ)", 9, "start")
rows = [["LINE", "ORDER", "HZ"],
        ["BPFO, OUTER RACE", f"{IMS_ZA2115['BPFO']:.3f}", f"{IMS_ZA2115['BPFO'] * f:.1f}"],
        ["BPFI, INNER RACE", f"{IMS_ZA2115['BPFI']:.3f}", f"{IMS_ZA2115['BPFI'] * f:.1f}"],
        ["2 × BSF, ROLLER", f"{2 * IMS_ZA2115['BSF']:.3f}", f"{2 * IMS_ZA2115['BSF'] * f:.1f}"],
        ["FTF, CAGE", f"{IMS_ZA2115['FTF']:.3f}", f"{IMS_ZA2115['FTF'] * f:.1f}"]]
D.table(tx, ty + 14, [190, 90, 90], 26, rows, 8)
D.text(tx, ty + 178, "BPFO = N/2 × F × (1 - D/P × COS A)", 8.5, "start")
D.text(tx, ty + 200, "BPFI = N/2 × F × (1 + D/P × COS A)", 8.5, "start")
D.text(tx, ty + 222, "BSF = P/2D × F × (1 - (D/P × COS A)²)", 8.5, "start")
D.text(tx, ty + 248, "N ROLLERS, D ROLLER Ø, P PITCH Ø,", 7.5, "start")
D.text(tx, ty + 266, "A CONTACT ANGLE, F SHAFT HZ", 7.5, "start")

# ---- the envelope spectrum of run 2, bearing 1, late in the failure ----
sp = rep["spectra"]["late"]
P = D.axes(1300, 140, 760, 250, (0, 800), (0, 1.1), [0, 100, 200, 300, 400, 500, 600, 700, 800], [],
           "ENVELOPE FREQUENCY, HZ", "")
pts = [P(fv, min(s, 1.1)) for fv, s in zip(sp["f"], sp["s"]) if fv <= 800]
D.pl(pts, "vis")
for k, lab, kind in (("BPFO", "BPFO 236.4", "hid"), ("BPFI", "BPFI 296.9", "cen")):
    fx = rep["lines_hz"][k]
    D.line(P(fx, 0), P(fx, 1.1), kind)
D.line(P(2 * rep["lines_hz"]["BPFO"], 0), P(2 * rep["lines_hz"]["BPFO"], 1.1), "hid")
D.line(P(2 * rep["lines_hz"]["BSF"], 0), P(2 * rep["lines_hz"]["BSF"], 1.1), "cen")
D.leader(P(rep["lines_hz"]["BPFO"], 1.0), (P(rep["lines_hz"]["BPFO"], 1.0)[0] + 70, 112), 26, "OUTER RACE LINE")
D.text(1300 + 380, 470, f"RUN 2, BEARING 1, HOUR {sp['h']:.0f}: SQUARED ENVELOPE SPECTRUM", 8.5)

# ---- health index, run 2 ----
r2 = rep["2"]
H = D.axes(1300, 590, 760, 230, (0, 164), (0, 40), [0, 24, 48, 72, 96, 120, 144, 164], [0, 6, 20, 40],
           "HOURS OF RUNNING", "")
D.text(1300, 572, "HEALTH INDEX, RUN 2, BEARING 1 SOLID, 2 TO 4 HATCHED", 8, "start")
for b in ("2", "3", "4"):
    d = r2["bearings"][b]
    D.pl([H(h, min(v, 40)) for h, v in zip(d["h"], d["hi"])], "hat")
d = r2["bearings"]["1"]
D.pl([H(h, min(v, 40)) for h, v in zip(d["h"], d["hi"])], "vis")
D.line(H(0, 6), H(164, 6), "cen")
D.text(H(164, 6)[0] - 4, H(164, 6)[1] - 6, "ALARM 6", 7.5, "end")
D.line(H(0, 0), H(0, 40), "dim")
D.rect(H(0, 40)[0], H(0, 40)[1], H(24, 0)[0] - H(0, 0)[0], H(0, 0)[1] - H(0, 40)[1], "dim")
D.text(H(12, 36)[0], H(12, 36)[1], "LEARNS", 7.5)
sus = r2["end_h"] - ims["2"]["summary"]["failed"]["1"]["sustained_lead_h"]
D.line(H(sus, 0), H(sus, 40), "thick")
D.leader(H(sus, 30), (H(sus, 30)[0] + 26, H(sus, 37)[1]), 18,
         f"WARNING HOLDS {ims['2']['summary']['failed']['1']['sustained_lead_h']:.1f} H BEFORE STOP")

# ---- lead times against a level-doubled alarm ----
lx, ly = 880, 610
D.text(lx, ly, "WARNING BEFORE THE RIG STOPPED, HOURS", 9, "start")
rows = [["FAILURE", "VIGIL", "LEVEL × 2"]]
for run in ("1", "2", "3"):
    for b, s in ims[run]["summary"]["failed"].items():
        part = {"BPFO": "OUTER", "BPFI": "INNER", "BSF": "ROLLER"}[s["part"]]
        rows.append([f"RUN {run} BRG {b} {part}", f"{s['sustained_lead_h']:.1f}", f"{s['level_x2_lead_h']:.1f}"])
D.table(lx, ly + 14, [190, 90, 110], 26, rows, 8)
D.text(lx, ly + 186, "NO HEALTHY-BEARING ALARM BEFORE ANY FAULT", 7.5, "start")
D.text(lx, ly + 204, "IN 3245 RUNNING HOURS", 7.5, "start")

# ---- notes ----
nx, ny = 120, 1000
D.text(nx, ny, "NOTES", 9, "start")
notes = ["1. LEARNS EACH BEARING FROM ITS FIRST 24 H. NEVER SHOWN A FAILURE.",
         "2. ALARM: WORST ROBUST Z OF 6 READINGS ≥ 6 ON 3 SNAPSHOTS IN A ROW.",
         "3. NAMED WHEN ONE DEFECT LINE STANDS ≥ 10 DB ABOVE ITS NEIGHBOURHOOD.",
         "4. BANDS 200 HZ TO 6 KHZ, AT LEAST 1 KHZ WIDE: IIS3DWB WITHIN 3 DB TO 6 KHZ."]
for i, n in enumerate(notes):
    D.text(nx, ny + 22 + 20 * i, n, 8, "start")

# VIGIL's own title block: the team, unsigned, so the drawing carries the
# project and nothing personal
D.table(1860, 1144, [110, 334], 34, [["TITLE", "VIGIL, BEARING DEFECT LINES"], ["DRAWN", "TEAM HEISENBUG"],
                                    ["SCALE", "AS STATED"], ["SHEET", "1 OF 1   REV A"]], 9)
D.write_sheet(os.path.join(HERE, "..", "docs", "sheet.svg"))

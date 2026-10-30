"""Drafting kit for the section sheets: an engineering drawing's conventions,
so every sheet reads as drawn by a draughtsman, not generated.

Line types by job (visible outline, hidden dashed, centre chain, thin
dimension and extension lines, 45-degree section hatch), filled arrowheads,
extension lines that stop short of the object and run just past the
dimension line, and single-stroke plotter lettering for the figures.
Each sheet is one 2400 x 1350 drawing, framed and title-blocked, laid behind
the whole page by theme.css (SECTION SHEETS) and cropped to the screen.
A character with no glyph is reported when the sheet is written, never
silently dropped. Run every sheet from this folder:
    for f in *.py; do [ "$f" = draft.py ] || python3 "$f"; done"""
import math

W, H = 600, 1350
# Blueprint blue since 27 Oct 2026 (was rgb(196,210,255), near white). A
# blue lifts the page less than near white at the same opacity (luma of the
# ink over the page base #0a0c11: 110.8 against 198.3), so every opacity is
# raised by LIFT and the layer in theme.css went from 0.7 to 1: 0.7 x 198.3 /
# 110.8 = 1.25. The lines are as bright as before, only bluer.
INK = "rgb(70,125,255)"
LIFT = 1.25


def op(a):
    return f"{a * LIFT:.3f}".rstrip("0")


def signature(x=1860, y=1144):
    """His signature in the title block's DRAWN row, beside "A. KAVYA", the way
    a draughtsman signs a sheet: the home page's own ink path (index.html,
    #sig-ink, read here so there is one copy of the shape), 46 units tall so
    its loops just overrun the 34-unit row, in the sheet's ink a shade above
    its lettering. Marked data-sig so sign.py can re-stamp a sheet without
    redrawing it."""
    import os, re
    # VIGIL's copy of the kit: the signature is read from his site's own home
    # page, so there is still one copy of the shape. Without it the sheet is
    # simply left unsigned.
    site = os.path.expanduser("~/Documents/amayakavya/index.html")
    if not os.path.exists(site):
        return ""
    page = open(site, encoding="utf-8").read()
    d = re.search(r'<path id="sig-ink" d="([^"]+)"', page).group(1)
    vb_w, vb_h = 584.05, 242.9                     # the signature's own viewBox
    h = 46.0
    s = h / vb_h
    sx, sy = x + 290, y + 34 + 17 - h / 2          # DRAWN row: y+34..y+68, centred on it
    return (f'<path data-sig="1" fill="{INK}" fill-opacity="{op(.14)}" stroke="none" '
            f'transform="translate({sx:.1f} {sy:.1f}) scale({s:.5f})" d="{d}"/>')

# single-stroke glyphs on a 4 x 6 grid (y down), the way a pen plotter letters
G = {
    "0": [[(1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0)]],
    "1": [[(1, 1.2), (2, 0), (2, 6)], [(1, 6), (3, 6)]],
    "2": [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 2), (0, 6), (4, 6)]],
    "3": [[(0, 0), (4, 0), (2, 2.5), (3, 2.5), (4, 3.5), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "4": [[(3, 6), (3, 0), (0, 4), (4, 4)]],
    "5": [[(4, 0), (0, 0), (0, 2.5), (3, 2.5), (4, 3.5), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "6": [[(3.5, 0), (1.5, 0), (0, 2), (0, 5), (1, 6), (3, 6), (4, 5), (4, 3.5), (3, 2.5), (1, 2.5), (0, 3.5)]],
    "7": [[(0, 0), (4, 0), (1.5, 6)]],
    "8": [[(1, 0), (3, 0), (4, 1), (4, 2), (3, 3), (1, 3), (0, 2), (0, 1), (1, 0)],
          [(1, 3), (0, 4), (0, 5), (1, 6), (3, 6), (4, 5), (4, 4), (3, 3)]],
    "9": [[(4, 2.5), (3, 3.5), (1, 3.5), (0, 2.5), (0, 1), (1, 0), (3, 0), (4, 1), (4, 4), (2.5, 6), (0.5, 6)]],
    ".": [[(1.8, 5.7), (2.2, 6)]],
    ",": [[(2.2, 5.6), (1.6, 6.8)]],
    "Ø": [[(1, 1), (3, 1), (4, 2), (4, 5), (3, 6), (1, 6), (0, 5), (0, 2), (1, 1)], [(4.3, 0), (-0.3, 6.8)]],
    "R": [[(0, 6), (0, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)], [(2, 3), (4, 6)]],
    "×": [[(0.6, 2.2), (3.4, 5)], [(3.4, 2.2), (0.6, 5)]],
    "A": [[(0, 6), (2, 0), (4, 6)], [(0.7, 4), (3.3, 4)]],
    "B": [[(0, 6), (0, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)], [(3, 3), (4, 4), (4, 5), (3, 6), (0, 6)]],
    "C": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5)]],
    "M": [[(0, 6), (0, 0), (2, 3.5), (4, 0), (4, 6)]],
    "-": [[(0.6, 3.2), (3.4, 3.2)]],
    ":": [[(1.8, 1.9), (2.2, 2.2)], [(1.8, 4.8), (2.2, 5.1)]],
    "(": [[(3, 0), (2, 1), (1.5, 3), (2, 5), (3, 6)]],
    ")": [[(1, 0), (2, 1), (2.5, 3), (2, 5), (1, 6)]],
    "°": [[(1, 0), (2, 0), (2.5, 0.6), (2, 1.2), (1, 1.2), (0.5, 0.6), (1, 0)]],
    "D": [[(0, 0), (0, 6), (2.5, 6), (4, 4.5), (4, 1.5), (2.5, 0), (0, 0)]],
    "E": [[(4, 0), (0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    "F": [[(4, 0), (0, 0), (0, 6)], [(0, 3), (3, 3)]],
    "G": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 5), (1, 6), (3, 6), (4, 5), (4, 3.5), (2.2, 3.5)]],
    "H": [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    "I": [[(1, 0), (3, 0)], [(2, 0), (2, 6)], [(1, 6), (3, 6)]],
    "J": [[(4, 0), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "K": [[(0, 0), (0, 6)], [(4, 0), (0, 3.6)], [(1.3, 2.8), (4, 6)]],
    "L": [[(0, 0), (0, 6), (4, 6)]],
    "N": [[(0, 6), (0, 0), (4, 6), (4, 0)]],
    "O": [[(1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0)]],
    "P": [[(0, 6), (0, 0), (3, 0), (4, 1), (4, 2), (3, 3), (0, 3)]],
    "Q": [[(1, 0), (3, 0), (4, 1), (4, 5), (3, 6), (1, 6), (0, 5), (0, 1), (1, 0)], [(2.5, 4.5), (4.2, 6.2)]],
    "S": [[(4, 1), (3, 0), (1, 0), (0, 1), (0, 2), (1, 3), (3, 3), (4, 4), (4, 5), (3, 6), (1, 6), (0, 5)]],
    "T": [[(0, 0), (4, 0)], [(2, 0), (2, 6)]],
    "U": [[(0, 0), (0, 5), (1, 6), (3, 6), (4, 5), (4, 0)]],
    "V": [[(0, 0), (2, 6), (4, 0)]],
    "W": [[(0, 0), (1, 6), (2, 2.5), (3, 6), (4, 0)]],
    "X": [[(0, 0), (4, 6)], [(4, 0), (0, 6)]],
    "Y": [[(0, 0), (2, 3), (4, 0)], [(2, 3), (2, 6)]],
    "Z": [[(0, 0), (4, 0), (0, 6), (4, 6)]],
    "/": [[(4, 0), (0, 6)]],
    "^": [[(0.6, 2.6), (2, 0.6), (3.4, 2.6)]],
    '"': [[(1.2, 0), (1.2, 1.6)], [(2.8, 0), (2.8, 1.6)]],
    "@": [[(3, 3.4), (2.6, 2), (1.6, 2), (1, 3), (1.4, 4.2), (2.4, 4.2), (3, 3.4), (3.2, 4.4), (4, 4), (4, 2), (3, 0.4), (1, 0.4), (0, 2), (0, 4.4), (1, 6), (3, 6), (4, 5.4)]],
    "{": [[(3, 0), (2, 0.4), (2, 2.4), (1, 3), (2, 3.6), (2, 5.6), (3, 6)]],
    "}": [[(1, 0), (2, 0.4), (2, 2.4), (3, 3), (2, 3.6), (2, 5.6), (1, 6)]],
    "[": [[(3, 0), (1.5, 0), (1.5, 6), (3, 6)]],
    "]": [[(1, 0), (2.5, 0), (2.5, 6), (1, 6)]],
    "?": [[(0.4, 1.2), (1.2, 0), (2.8, 0), (3.6, 1.2), (3.6, 2.2), (2, 3.4), (2, 4.4)], [(1.9, 5.7), (2.1, 6)]],
    "!": [[(2, 0), (2, 4.2)], [(1.9, 5.7), (2.1, 6)]],
    "&": [[(4, 6), (0.9, 2.3), (1.1, 0.6), (2.2, 0), (3, 0.8), (2.7, 2), (0.5, 4.1), (0.6, 5.5), (1.8, 6.1), (3.2, 4.8), (3.9, 3.7)]],
    "|": [[(2, -0.5), (2, 6.5)]],
    "=": [[(0.4, 2.3), (3.6, 2.3)], [(0.4, 4.1), (3.6, 4.1)]],
    "<": [[(3.6, 0.8), (0.4, 3.2), (3.6, 5.6)]],
    ">": [[(0.4, 0.8), (3.6, 3.2), (0.4, 5.6)]],
    "%": [[(0.2, 6), (3.8, 0)], [(0.4, 0.4), (1.4, 0.4), (1.4, 1.6), (0.4, 1.6), (0.4, 0.4)], [(2.6, 4.4), (3.6, 4.4), (3.6, 5.6), (2.6, 5.6), (2.6, 4.4)]],
    "+": [[(0.5, 3.2), (3.5, 3.2)], [(2, 1.7), (2, 4.7)]],
    "'": [[(2, 0), (1.7, 1.6)]],
    "#": [[(1.2, 0.5), (0.8, 5.5)], [(3.2, 0.5), (2.8, 5.5)], [(0, 2), (4, 2)], [(0, 4), (4, 4)]],
    "$": [[(4, 1.2), (3, 0.4), (1, 0.4), (0, 1.4), (0, 2.2), (1, 3), (3, 3), (4, 3.8), (4, 4.8), (3, 5.6), (1, 5.6), (0, 4.8)], [(2, -0.4), (2, 6.4)]],
    "*": [[(2, 1), (2, 5)], [(0.4, 1.9), (3.6, 4.1)], [(3.6, 1.9), (0.4, 4.1)]],
    "²": [[(0.8, 0.6), (1.4, 0), (2.6, 0), (3.2, 0.6), (3.2, 1.2), (0.8, 2.8), (3.2, 2.8)]],
    ";": [[(1.8, 1.9), (2.2, 2.2)], [(2.2, 4.8), (1.6, 6.6)]],
    "_": [[(0, 6.4), (4, 6.4)]],
    "~": [[(0.2, 3.6), (1, 2.8), (2, 3.4), (3, 4), (3.8, 3.2)]],
    "≤": [[(3.6, 0.4), (0.4, 2.6), (3.6, 4.8)], [(0.4, 6), (3.6, 6)]],
    "≥": [[(0.4, 0.4), (3.6, 2.6), (0.4, 4.8)], [(0.4, 6), (3.6, 6)]],
    "→": [[(0, 3.2), (4, 3.2)], [(2.6, 1.8), (4, 3.2), (2.6, 4.6)]],
    "Σ": [[(4, 0.6), (4, 0), (0, 0), (2.2, 3), (0, 6), (4, 6), (4, 5.4)]],
    "·": [[(1.8, 3.0), (2.2, 3.3)]],
    "\\": [[(0, 0), (4, 6)]],
    "`": [[(1.4, 0), (2.4, 1.4)]],
    "←": [[(4, 3.2), (0, 3.2)], [(1.4, 1.8), (0, 3.2), (1.4, 4.6)]],
    " ": [],
}
MISSING = set()                                                # characters asked for that have no glyph
ADV = 5.4                                                      # advance per glyph, in grid units


def _n(v):
    t = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if t in ("-0", "") else t


class Sheet:
    def __init__(self):
        self.L = {k: [] for k in ("vis", "hid", "cen", "dim", "hat", "txt", "arw", "thick")}

    # ---- strokes ----
    def pl(self, pts, kind="vis", close=False):
        # one decimal of a sheet unit (a tenth of a pixel at 1:1) and implicit
        # lineto after the M: the same strokes in about half the bytes
        self.L[kind].append("M" + " ".join(f"{_n(x)} {_n(y)}" for x, y in pts) + ("Z" if close else ""))

    def line(self, a, b, kind="vis"):
        self.pl([a, b], kind)

    def rect(self, x, y, w, h, kind="vis"):
        self.pl([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], kind, True)

    def circle(self, cx, cy, r, kind="vis"):
        self.L[kind].append(f"M{cx + r:.2f} {cy:.2f}a{r:.2f} {r:.2f} 0 1 0 {-2 * r:.2f} 0a{r:.2f} {r:.2f} 0 1 0 {2 * r:.2f} 0")

    def arc(self, cx, cy, r, a0, a1, kind="vis", n=16):
        self.pl([(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
                  cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)], kind)

    def rrect(self, x, y, w, h, r, kind="vis"):
        """a rectangle with rounded corners, as one outline"""
        pts = []
        for cx, cy, a0 in ((x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)):
            pts += [(cx + r * math.cos(math.radians(a0 + 90 * i / 8)), cy + r * math.sin(math.radians(a0 + 90 * i / 8))) for i in range(9)]
        self.pl(pts, kind, True)

    def centre(self, cx, cy, r, over=6):
        """a hole's centre mark and chain centre lines running just past it"""
        self.line((cx - 2.5, cy), (cx + 2.5, cy), "dim")
        self.line((cx, cy - 2.5), (cx, cy + 2.5), "dim")
        self.line((cx - r - over, cy), (cx + r + over, cy), "cen")
        self.line((cx, cy - r - over), (cx, cy + r + over), "cen")

    def hatch(self, x, y, w, h, gap=4.0, ang=45):
        """45-degree section hatch clipped to a rectangle"""
        s = 1 if ang == 45 else -1
        c = -h
        while c < w:
            pts = []
            for t in (0, h):                                     # where x' = c + s*t crosses the rectangle
                pts.append((x + c + (t if s > 0 else h - t), y + t))
            (x0, y0), (x1, y1) = pts
            # clip the segment to x in [x, x+w]
            def clip(p, q):
                (ax, ay), (bx, by) = p, q
                if bx == ax:
                    return p, q
                t0, t1 = 0.0, 1.0
                for lim, sign in ((x, 1), (x + w, -1)):
                    num = (ax - lim) * sign
                    den = (bx - ax) * sign
                    if den == 0:
                        continue
                    t = -num / den
                    if den > 0:
                        t0 = max(t0, t)
                    else:
                        t1 = min(t1, t)
                if t1 <= t0:
                    return None
                return (ax + (bx - ax) * t0, ay + (by - ay) * t0), (ax + (bx - ax) * t1, ay + (by - ay) * t1)
            seg = clip((x0, y0), (x1, y1))
            if seg:
                self.line(seg[0], seg[1], "hat")
            c += gap

    # ---- lettering ----
    def text(self, x, y, s, h=9.0, anchor="middle", rot=0):
        """plotter lettering: y is the baseline; rot -90 reads bottom to top"""
        k = h / 6
        width = (len(s) * ADV - (ADV - 4)) * k
        x0 = {"start": 0, "middle": -width / 2, "end": -width}[anchor]
        ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        for i, ch in enumerate(s):
            if ch not in G:
                MISSING.add(ch)
            for stroke in G.get(ch, []):
                pts = []
                for gx, gy in stroke:
                    u, v = x0 + (i * ADV + gx) * k, (gy - 6) * k
                    pts.append((x + u * ca - v * sa, y + u * sa + v * ca))
                self.pl(pts, "txt")

    # ---- dimensioning ----
    def arrow(self, tip, toward, size=7.0, half=1.9):
        ux, uy = toward[0] - tip[0], toward[1] - tip[1]
        L = math.hypot(ux, uy) or 1
        ux, uy = ux / L, uy / L
        bx, by = tip[0] + ux * size, tip[1] + uy * size
        self.L["arw"].append(f"M{tip[0]:.2f} {tip[1]:.2f}L{bx - uy * half:.2f} {by + ux * half:.2f}L{bx + uy * half:.2f} {by - ux * half:.2f}Z")

    def hdim(self, x1, x2, yobj1, yobj2, ydim, value, h=8.5, above=True):
        """a horizontal dimension: extension lines from each feature, the dimension line, arrows, the figure"""
        for x, yo in ((x1, yobj1), (x2, yobj2)):
            sgn = 1 if ydim > yo else -1
            self.line((x, yo + sgn * 3), (x, ydim + sgn * 4), "dim")
        self.line((x1, ydim), (x2, ydim), "dim")
        self.arrow((x1, ydim), (x2, ydim))
        self.arrow((x2, ydim), (x1, ydim))
        self.text((x1 + x2) / 2, ydim - 3 if above else ydim + h + 3, value, h)

    def vdim(self, y1, y2, xobj1, xobj2, xdim, value, h=8.5):
        for y, xo in ((y1, xobj1), (y2, xobj2)):
            sgn = 1 if xdim > xo else -1
            self.line((xo + sgn * 3, y), (xdim + sgn * 4, y), "dim")
        self.line((xdim, y1), (xdim, y2), "dim")
        self.arrow((xdim, y1), (xdim, y2))
        self.arrow((xdim, y2), (xdim, y1))
        self.text(xdim - 3, (y1 + y2) / 2, value, h, "middle", -90)

    def leader(self, tip, knee, shoulder_dx, label, h=8.5):
        """a leader: an arrow on the feature, a slanted line, a short shoulder, the note"""
        self.arrow(tip, knee)
        self.line(tip, knee, "dim")
        end = (knee[0] + shoulder_dx, knee[1])
        self.line(knee, end, "dim")
        if shoulder_dx < 0:
            self.text(end[0] - 2, knee[1] - 3, label, h, "end")
        else:
            self.text(end[0] + 2, knee[1] - 3, label, h, "start")

    def balloon(self, cx, cy, n, tip):
        self.circle(cx, cy, 9, "dim")
        self.text(cx, cy + 4, str(n), 8)
        a = math.atan2(tip[1] - cy, tip[0] - cx)
        self.line((cx + 9 * math.cos(a), cy + 9 * math.sin(a)), tip, "dim")
        self.L["arw"].append(f"M{tip[0] + 1.6:.2f} {tip[1]:.2f}a1.6 1.6 0 1 0 -3.2 0a1.6 1.6 0 1 0 3.2 0Z")

    def cut(self, x1, x2, y, letter, down=True):
        """a cutting-plane line: thick chain, heavy ends, arrows showing the view direction, the letters"""
        self.line((x1, y), (x2, y), "cen")
        for x in (x1, x2):
            self.line((x, y), (x + (10 if x == x1 else -10), y), "thick")
            d = 12 if down else -12
            self.line((x, y), (x, y + d * 0.2), "thick")
            self.arrow((x, y + d), (x, y), 6, 1.7)
            self.line((x, y), (x, y + d), "dim")
            self.text(x, y + d + (12 if down else -4), letter, 8.5)

    def breakline(self, x, y0, y1):
        """a freehand-style break: a gentle S down the cut edge"""
        n = 14
        self.pl([(x + 3.5 * math.sin(i / n * 2 * math.pi), y0 + (y1 - y0) * i / n) for i in range(n + 1)], "vis")

    def write_sheet(self, path, w=2400, h=1350):
        if MISSING:
            print("NO GLYPH FOR:", "".join(sorted(MISSING)))
        def g(kind, op, sw, extra=""):
            d = self.L[kind]
            return (f'<path stroke-opacity="{op}" stroke-width="{sw}" vector-effect="non-scaling-stroke"{extra} d="{"".join(d)}"/>'
                    if d else "")
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice" '
               f'fill="none" stroke="{INK}" stroke-linecap="round" stroke-linejoin="round">'
               + g("hat", op(.05), 0.4)
               + g("cen", op(.08), 0.45, ' stroke-dasharray="16 3 2 3"')
               + g("hid", op(.09), 0.55, ' stroke-dasharray="5 3"')
               + g("dim", op(.095), 0.42)
               + g("txt", op(.115), 0.5)
               + g("vis", op(.135), 0.8)
               + g("thick", op(.135), 1.3)
               + (f'<path fill="{INK}" fill-opacity="{op(.11)}" stroke="none" d="{"".join(self.L["arw"])}"/>' if self.L["arw"] else "")
               + (signature(*self.signed) if getattr(self, "signed", None) else "")
               + "</svg>\n")
        open(path, "w").write(svg)
        print(f"{path.split('/')[-1]}: {len(svg) / 1024:.1f} KiB")

    def frame(self, w=2400, h=1350, cols=8, rows=6):
        """the sheet's trim and border, with zone ticks and their numbers and letters"""
        self.rect(22, 22, w - 44, h - 44, "dim")
        self.rect(52, 52, w - 104, h - 104, "vis")
        cw, rh = (w - 104) / cols, (h - 104) / rows
        for i in range(cols + 1):
            x = 52 + i * cw
            self.line((x, 22), (x, 52), "dim")
            self.line((x, h - 52), (x, h - 22), "dim")
            if i < cols:
                self.text(x + cw / 2, 42, str(cols - i), 9)
                self.text(x + cw / 2, h - 32, str(cols - i), 9)
        for j in range(rows + 1):
            y = 52 + j * rh
            self.line((22, y), (52, y), "dim")
            self.line((w - 52, y), (w - 22, y), "dim")
            if j < rows:
                self.text(37, y + rh / 2 + 4.5, "ABCDEF"[j], 9)
                self.text(w - 37, y + rh / 2 + 4.5, "ABCDEF"[j], 9)

    def table(self, x, y, colw, rowh, rows, h=8.5):
        """a ruled table: rows of cells, each cell's text left-set"""
        tw = sum(colw)
        self.rect(x, y, tw, rowh * len(rows), "vis")
        for r in range(1, len(rows)):
            self.line((x, y + r * rowh), (x + tw, y + r * rowh), "dim")
        cx = x
        for c in colw[:-1]:
            cx += c
            self.line((cx, y), (cx, y + rowh * len(rows)), "dim")
        for r, row in enumerate(rows):
            cx = x
            for c, cell in zip(colw, row):
                self.text(cx + 8, y + r * rowh + rowh / 2 + h / 2, cell, h, "start")
                cx += c

    def axes(self, x0, y0, w, h, xr, yr, xticks, yticks, xlab="", ylab="", fmt=lambda v: f"{v:g}", grid=False):
        """a drafted plot frame: axes, ticks with their figures, axis titles; returns a mapper to the frame"""
        X = lambda v: x0 + (v - xr[0]) / (xr[1] - xr[0]) * w
        Y = lambda v: y0 + h - (v - yr[0]) / (yr[1] - yr[0]) * h
        self.line((x0, y0 + h), (x0 + w, y0 + h), "vis")
        self.line((x0, y0), (x0, y0 + h), "vis")
        for v in xticks:
            self.line((X(v), y0 + h), (X(v), y0 + h + 5), "dim")
            self.text(X(v), y0 + h + 17, fmt(v), 7.5)
            if grid:
                self.line((X(v), y0), (X(v), y0 + h), "hat")
        for v in yticks:
            self.line((x0 - 5, Y(v)), (x0, Y(v)), "dim")
            self.text(x0 - 8, Y(v) + 3.5, fmt(v), 7.5, "end")
            if grid:
                self.line((x0, Y(v)), (x0 + w, Y(v)), "hat")
        if xlab:
            self.text(x0 + w / 2, y0 + h + 36, xlab, 8)
        if ylab:
            self.text(x0 - 44, y0 + h / 2, ylab, 8, "middle", -90)
        return lambda x, y: (X(x), Y(y))

    def box(self, x, y, w, h, label, kind="vis", size=7.5):
        """a labelled block; label lines split on |"""
        self.rect(x, y, w, h, kind)
        lines = label.split("|")
        lh = size * 1.6
        top = y + h / 2 - (len(lines) - 1) * lh / 2 + size / 2
        for i, ln in enumerate(lines):
            self.text(x + w / 2, top + i * lh, ln, size)
        return (x, y, w, h)

    def diamond(self, cx, cy, w, h, label, size=7.5):
        self.pl([(cx, cy - h / 2), (cx + w / 2, cy), (cx, cy + h / 2), (cx - w / 2, cy)], "vis", True)
        lines = label.split("|")
        for i, ln in enumerate(lines):
            self.text(cx, cy + size / 2 + (i - (len(lines) - 1) / 2) * size * 1.6, ln, size)

    def flow(self, pts, kind="vis"):
        """a connector along pts with an arrowhead at its end"""
        self.pl(pts, kind)
        self.arrow(pts[-1], pts[-2], 6.5, 1.8)

    def titleblock(self, title, scale="1:1 UNLESS STATED", rev="A", x=1860, y=1144):
        """the title block, bottom right: what the sheet is, who drew it, its scale"""
        self.table(x, y, [110, 334], 34, [["TITLE", title], ["DRAWN", "A. KAVYA"],
                                          ["SCALE", scale], ["SHEET", "1 OF 1   REV " + rev]], 9)
        self.signed = (x, y)          # write_sheet() signs the DRAWN row

    def partslist(self, rows, x=1860, y=None):
        """a parts list sitting on the title block: item, description, quantity"""
        n = len(rows) + 1
        y = 1144 - 12 - 28 * n if y is None else y
        self.table(x, y, [44, 250, 150], 28, [["ITEM", "DESCRIPTION", "QTY"]] + rows, 8.5)

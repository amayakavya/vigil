"""Every headline figure, recomputed from the result files and checked against
each place it is published: the page, the deck, the README and the form text.
Also fails on a semicolon or a dash in any of their prose. Exits non-zero on
the first disagreement, so nothing ships with a number that has drifted."""
import json, os, re, sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
ims = json.load(open(os.path.join(ROOT, "docs", "data", "ims.json")))
cwru = json.load(open(os.path.join(ROOT, "docs", "data", "cwru.json")))

failed = [s for r in ("1", "2", "3") for s in ims[r]["summary"]["failed"].values()]
sus = [s["sustained_lead_h"] for s in failed]
gain = [s["sustained_lead_h"] - s["level_x2_lead_h"] for s in failed]
named = sum(s["final_72h_named"] for s in failed)
right = sum(s["final_72h_correct"] for s in failed)
pre_h = sum(ims[r]["summary"]["pre_fault"]["running_h"] for r in ("1", "2", "3"))
pre_alarms = sum(ims[r]["summary"]["pre_fault"]["alarms"]["vigil"] for r in ("1", "2", "3"))
crossings = sum(ims[r]["summary"]["pre_fault"]["single_crossings"] for r in ("1", "2", "3"))
after = sum(ims[r]["summary"]["after_fault_healthy_alarms"] for r in ("1", "2", "3"))
traced = sum(ims[r]["summary"]["after_fault_traced"] for r in ("1", "2", "3"))
cw = cwru["summary"]

assert pre_alarms == 0, "a healthy bearing alarmed before any fault"
assert after == traced, "a post-fault healthy alarm was not traced to the failing bearing"
assert all(g > 0 for g in gain), "VIGIL was not earlier than the level-doubled alarm on every failure"

claims = {
    "failures warned": f"{len(failed)} of {len(failed)}",
    "sustained range": f"{min(sus):.0f} to {max(sus):.0f}",
    "earlier than level doubled": f"{min(gain):.0f} to {max(gain):.0f}",
    "named in last 72 h": f"{right} of {named}",
    "pre-fault running hours": f"{pre_h:,.0f}",
    "Case Western named": f"{cw['named_correctly']} of {cw['files']}",
}
L = json.load(open(os.path.join(ROOT, "docs", "data", "learned.json")))
claims["learned model"] = f"named {L['headline']['model_alone']['right']} right and {L['headline']['model_alone']['wrong']} wrong"
claims["physics on held-out"] = f"names {L['physics']['right']} right and {L['physics']['wrong']} wrong"
print("from the data:", json.dumps(claims), f"| single crossings {crossings}, post-fault healthy alarms {after}, traced {traced}")
assert crossings == 7 and after == 8, "the page's 'seven single readings' or 'eight healthy bearings' is out of date"
assert f"{0.1 / 13.73 * 100:.2f}" == "0.73"


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.skip = 0; self.out = []
    def handle_starttag(self, t, a): self.skip += t in ("script", "style")
    def handle_endtag(self, t): self.skip -= t in ("script", "style")
    def handle_data(self, d):
        if not self.skip and d.strip(): self.out.append(d.strip())


pages = ""
for name in ("index.html", "results.html"):
    t = Text(); t.feed(open(os.path.join(ROOT, "docs", name)).read()); pages += " " + " ".join(t.out)
sources = {"page": pages}
t = Text(); t.feed(open(os.path.join(ROOT, "docs", "results.html")).read()); sources["results"] = " ".join(t.out)
# the demonstration stands on its own: nothing published may link to the author's personal site
for name in os.listdir(os.path.join(ROOT, "docs")):
    if name.endswith((".html", ".js", ".css", ".webmanifest")) and "amayakavya.com" in open(os.path.join(ROOT, "docs", name)).read():
        print(f"LINK to amayakavya.com in docs/{name}"); sys.exit(1)
deck_file = os.path.join(ROOT, "deck", "VIGIL-HEISENBUG-Seva2026.pptx")
if os.path.exists(deck_file):          # the deck is built locally from the challenge's template, not published
    from pptx import Presentation
    deck = []
    for s in Presentation(deck_file).slides:
        for sh in s.shapes:
            if sh.has_text_frame:
                deck.append(sh.text_frame.text)
            if sh.has_table:
                deck += [c.text for r in sh.table.rows for c in r.cells]
    sources["deck"] = " ".join(deck)
readme = open(os.path.join(ROOT, "README.md")).read()
sources["readme"] = re.sub(r"```.*?```", "", readme, flags=re.S)
app = os.path.join(ROOT, "APPLICATION.md")
if os.path.exists(app):
    sources["form"] = open(app).read()

need = {
    "page": ["failures warned", "sustained range", "earlier than level doubled", "named in last 72 h", "pre-fault running hours"],
    "deck": ["failures warned", "sustained range", "earlier than level doubled", "named in last 72 h", "pre-fault running hours"],
    "form": ["sustained range", "earlier than level doubled", "named in last 72 h", "pre-fault running hours"],
    "readme": [],
    "results": ["learned model", "physics on held-out"],
}
bad = 0
for where, keys in need.items():
    if where not in sources:
        continue
    for k in keys:
        if claims[k] not in sources[where]:
            print(f"MISSING in {where}: {k} = {claims[k]!r}"); bad += 1
    for m in re.finditer(r"[;—–]", sources[where]):
        ctx = sources[where][max(0, m.start() - 50):m.end() + 20].replace("\n", " ")
        print(f"PUNCTUATION in {where}: ...{ctx}..."); bad += 1
# stale figures from earlier drafts must be gone everywhere
for stale in ("42 to 603", "5,366", "flat to about 6 kHz", "Motor Transport section, about 60", "named all 4", "FW_REPLAY", "FW_DECK_LINE", "FW_FORM_LINE", "FW_QA_LINE"):
    for where, text in sources.items():
        if stale in text:
            print(f"STALE in {where}: {stale!r}"); bad += 1
print("all published figures agree with the data, no semicolons or dashes" if not bad else f"{bad} problem(s)")
sys.exit(1 if bad else 0)

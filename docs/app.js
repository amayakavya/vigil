/* VIGIL's board, run on NASA's three run-to-failure tests. Each test is one
   shaft with four bearings, each bearing one measuring point. Every status,
   warning and name is the analysis's own result for that bearing
   (data/replay.json), every waterfall column is one real snapshot's envelope
   spectrum (data/waterfall-*.bin, from analysis/waterfall.py), and nothing is
   drawn ahead of the replay clock: the board knows only what a board on the
   day would have known. The only arrangement is that the three tests start
   together. */
(() => {
"use strict";
const PART = { BPFO: "outer race", BPFI: "inner race", BSF: "rolling element" };
const DRIVER = { "log RMS": "overall level", kurtosis: "spikiness (kurtosis)", "crest factor": "crest factor",
  "BPFO line": "outer race line", "BPFI line": "inner race line", "BSF line": "rolling element line" };
const MACHINES = [
  { id: "T1", name: "NASA test 1", run: "1", start: 0 },
  { id: "T2", name: "NASA test 2", run: "2", start: 0 },
  { id: "T3", name: "NASA test 3", run: "3", start: 0 },
];
const BEARING = "Rexnord ZA-2115";
const INK = "#e8ebee", MID = "#a9b0b9", DIM = "#77808b", FAINT = "#454d57", RULE = "#1b2129", AMBER = "#ffb000";
const FONT = "10px Inter, system-ui, sans-serif";
const $ = id => document.getElementById(id);
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const put = (e, text) => { if (e.textContent !== text) e.textContent = text; };
const cap = s => s[0].toUpperCase() + s.slice(1);
const stamp = t => { const d = Math.floor(t / 24), hh = Math.floor(t % 24), mm = Math.floor((t * 60) % 60); return `Day ${d + 1}, ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; };
const span = v => v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} days`;
// when the snapshot at test time t was actually recorded, from the test's own start
function recorded(m, t) {
  const d = new Date(Date.parse(R[m.run].start + "Z") + t * 3600e3);
  return d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

let R = null, WF = null, END = 0, T = 0, speed = 24, playing = false, last = 0;
let EVENTS = [], JOBS = [];
let sel = { m: MACHINES[1], key: "1" }, pinned = false;
let hover = null;                         // the pointer over a plot: { fall, x, y } in the plot's own pixels
const IDLE = { trend: $("rd-trend").textContent, fall: $("rd-fall").textContent };
const fall = {}, fallImg = {};

function at(b, t) {                       // index of the reading at or just before local time t
  let lo = 0, hi = b.h.length - 1;
  if (t < b.h[0]) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b.h[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}
const hiAt = (b, t) => { const i = at(b, t); return i < 0 ? null : b.hi[i]; };
// NASA's tests stopped overnight and over weekends; a stretch of more than
// three hours with no reading is the machine not running
function idleAt(b, t) { const i = at(b, t); return i >= 0 && i + 1 < b.h.length && b.h[i + 1] - b.h[i] > 3 && t - b.h[i] > 0.5; }

function statusAt(m, key, now) {
  const r = R[m.run], b = r.bearings[key], t = now - m.start;
  if (t < 0) return { long: "Not started yet", short: "Not started", cls: "quiet" };
  if (t >= r.end_h) return b.failed
    ? { long: `Failed: ${PART[b.failed]}. NASA stopped the test here.`, short: `Failed, ${PART[b.failed]}`, cls: "warn" }
    : { long: "Stopped with the rig. This bearing did not fail.", short: "Stopped with rig", cls: "quiet" };
  const idle = idleAt(b, t);
  if (t < r.base_h) return idle ? { long: "Not running. Learning resumes when it starts.", short: "Not running", cls: "quiet", idle }
                                : { long: "Learning its normal", short: "Learning", cls: "quiet" };
  const named = b.named_h != null && t >= b.named_h, alarmed = b.alarm_h != null && t >= b.alarm_h;
  const mine = n => n == null || String(n) === key;
  let s;
  if (named && mine(b.named_loudest)) s = { long: `Warning: ${PART[b.named_as]} defect. Replace the bearing.`, short: `Warning, ${PART[b.named_as]}`, cls: "warn" };
  else if (alarmed && mine(b.loudest_at_alarm)) s = { long: "Warning: vibration has changed. Inspect, part not named yet.", short: "Warning, inspect", cls: "warn" };
  else if (named || alarmed) { const n = named ? b.named_loudest : b.loudest_at_alarm; s = { long: `Hearing bearing ${n}. No action here.`, short: `Hears bearing ${n}`, cls: "quiet" }; }
  else s = { long: "Normal", short: "Normal", cls: "ok" };
  if (!idle) return s;
  // a warning stands until a mechanic clears it, running or not
  return s.cls === "warn" ? { long: "Not running. " + s.long.replace("Warning:", "Warning stands:"), short: s.short, cls: "warn", idle }
                          : { long: "Not running, no readings", short: "Not running", cls: "quiet", idle };
}

function buildEvents() {
  // one job per bearing, opened at its own first warning (the alarm or the
  // name, whichever came first) and upgraded to a replacement once named
  for (const m of MACHINES) {
    for (const [key, d] of Object.entries(R[m.run].bearings)) {
      const own = n => n == null || String(n) === key;
      const alarm = d.alarm_h != null && own(d.loudest_at_alarm) ? d.alarm_h : null;
      const named = d.named_h != null && own(d.named_loudest) ? d.named_h : null;
      if (alarm == null && named == null) continue;
      JOBS.push({ m, key, d, run: m.run, open: m.start + Math.min(...[alarm, named].filter(v => v != null)),
                  named: named == null ? null : m.start + named, alarm: alarm == null ? null : m.start + alarm });
    }
  }
  JOBS.sort((a, b) => a.open - b.open);
  JOBS.forEach((j, i) => { j.id = `VG-${String(i + 1).padStart(3, "0")}`; });
  const jobOf = (m, key) => JOBS.find(j => j.m === m && j.key === key);
  for (const m of MACHINES) {
    const r = R[m.run];
    EVENTS.push({ t: m.start, text: `${m.name}: four sensors reading, learning its normal. Recorded ${recorded(m, 0)}.` });
    EVENTS.push({ t: m.start + 24, text: `${m.name}: learned its normal from its first 24 hours of readings.` });
    for (const [key, d] of Object.entries(r.bearings)) {
      const j = jobOf(m, key);
      if (d.alarm_h != null) {
        const t = m.start + d.alarm_h, why = DRIVER[d.alarm_driver] || d.alarm_driver;
        if (!j || j.alarm == null) EVENTS.push({ t, text: `${m.name}, bearing ${key}: alarm traced to bearing ${d.loudest_at_alarm}, the loudest on the shaft. No job.` });
        else if (j.named != null && j.named <= t) EVENTS.push({ t, text: `${m.name}, bearing ${key}: health index past the alarm too (${why}). Job ${j.id} already open.` });
        else EVENTS.push({ t, key: true, text: `${m.name}, bearing ${key}: vibration has changed (${why}). Job ${j.id} raised to inspect.` });
      }
      if (d.named_h != null) {
        const t = m.start + d.named_h;
        if (!j || j.named == null) EVENTS.push({ t, text: `${m.name}, bearing ${key}: hears the ${PART[d.named_as]} line of bearing ${d.named_loudest}. No job.` });
        else if (j.alarm != null && j.alarm < t) EVENTS.push({ t, key: true, text: `${m.name}, bearing ${key}: ${PART[d.named_as]} defect named. Job ${j.id} is now a replacement.` });
        else EVENTS.push({ t, key: true, text: `${m.name}, bearing ${key}: ${PART[d.named_as]} defect named. Job ${j.id} raised to replace the bearing.` });
      }
    }
    const failed = Object.entries(r.bearings).filter(([, d]) => d.failed).map(([k, d]) => `bearing ${k} (${PART[d.failed]})`).join(" and ");
    EVENTS.push({ t: m.start + r.end_h, key: true, text: `${m.name}: stopped ${recorded(m, r.end_h)}. NASA ended the test with ${failed} failed.` });
  }
  EVENTS.sort((a, b) => a.t - b.t);
}
const jobOf = (m, key) => JOBS.find(j => j.m === m && j.key === key);

/* ---------- the machines ---------- */
const ui = { rigs: [], logCount: -1 };
function buildFleet() {
  const host = $("fleet");
  for (const m of MACHINES) {
    const box = h("div", "rig"), head = h("div", "rig-h"), sub = h("span");
    head.append(h("b", null, m.name), sub); box.appendChild(head);
    const points = [];
    for (const key of ["1", "2", "3", "4"]) {
      const row = h("button", "pnt"), st = h("span", "s"), v = h("span", "v");
      row.type = "button";
      row.append(h("i"), h("span", "k", key), st, v);
      row.setAttribute("aria-label", `${m.name}, bearing ${key}`);
      row.onclick = () => { sel = { m, key }; pinned = true; render(); };
      box.appendChild(row);
      points.push({ row, st, v, key });
    }
    host.appendChild(box);
    ui.rigs.push({ m, sub, points });
  }
}
function renderFleet() {
  for (const u of ui.rigs) {
    const r = R[u.m.run], t = T - u.m.start;
    put(u.sub, t >= r.end_h ? `Ended ${recorded(u.m, r.end_h)}` : idleAt(r.bearings["1"], t) ? "Rig stopped" : recorded(u.m, t));
    for (const p of u.points) {
      const b = r.bearings[p.key], s = statusAt(u.m, p.key, T), tt = Math.min(t, r.end_h), v = hiAt(b, tt);
      put(p.st, s.short);
      const cls = "pnt " + s.cls;
      if (p.row.className !== cls) p.row.className = cls;
      put(p.v, tt < r.base_h || v == null || s.idle ? "" : v >= 99 ? "99+" : v.toFixed(1));
      const on = String(u.m === sel.m && p.key === sel.key);
      if (p.row.getAttribute("aria-pressed") !== on) p.row.setAttribute("aria-pressed", on);
    }
  }
}

/* ---------- the selected point ---------- */
function renderPoint() {
  const { m, key } = sel, r = R[m.run], b = r.bearings[key], t = T - m.start, tt = Math.min(t, r.end_h), s = statusAt(m, key, T);
  put($("pt-title"), `${m.name} / bearing ${key}`);
  put($("pt-follow"), pinned ? "Pinned. Follow newest warning" : "Following newest warning");
  const st = $("pt-state"), cls = "state" + (s.cls === "warn" ? " warn" : s.cls === "quiet" ? " quiet" : "");
  put(st, s.long);
  if (st.className !== cls) st.className = cls;
  const v = hiAt(b, tt), j = jobOf(m, key), open = j && j.open <= T;
  const cells = [
    ["Health index", tt < r.base_h ? "Learning" : s.idle || v == null ? "No reading" : v >= 99 ? "99+" : v.toFixed(2)],
    ["Recorded", recorded(m, tt)],
    ["To NASA's stop", t >= r.end_h ? "Stopped" : span(r.end_h - t)],
    open ? (t >= r.end_h ? ["Warned ahead by", span(m.start + r.end_h - j.open)] : ["Warning raised", `${span(T - j.open)} ago`]) : ["Bearing", BEARING],
  ];
  const host = $("pt-reads");
  if (!host.children.length) for (let i = 0; i < 4; i++) { const d = h("div"); d.append(h("dt"), h("dd")); host.appendChild(d); }
  cells.forEach(([k, val], i) => { put(host.children[i].firstChild, k); put(host.children[i].lastChild, val); });
}

function fit(cv) {
  const box = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(box.width)), hgt = Math.max(1, Math.round(box.height));
  if (cv.width !== w * d || cv.height !== hgt * d) { cv.width = w * d; cv.height = hgt * d; }
  const c = cv.getContext("2d");
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, w, hgt);
  c.font = FONT; c.textBaseline = "middle";
  return { c, w, h: hgt };
}
// the two plots share their left and right edges, so a moment in the trend sits above the same moment in the waterfall
const edges = w => ({ L: 38, Rr: w - (w < 520 ? 78 : 96) });
function rule(c, x1, y1, x2, y2, colour, dash) {
  c.beginPath(); c.setLineDash(dash || []); c.strokeStyle = colour; c.lineWidth = 1;
  c.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5); c.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5); c.stroke(); c.setLineDash([]);
}
function days(c, r, x, y) {
  const total = r.end_h / 24, step = total <= 10 ? 1 : total <= 20 ? 2 : 5;
  c.fillStyle = DIM; c.textAlign = "center";
  for (let d = 0; d * 24 < r.end_h; d += step) {
    if (d === 0) { c.textAlign = "left"; c.fillText("Day 1", x(0), y); c.textAlign = "center"; }
    else if (x(d * 24) < x(r.end_h) - 26) c.fillText(String(d + 1), x(d * 24), y);
  }
}

function drawTrend() {
  const { c, w, h: H } = fit($("cv-trend")), { m, key } = sel, r = R[m.run], b = r.bearings[key], t = Math.max(0, Math.min(T - m.start, r.end_h));
  const { L, Rr } = edges(w), top = 6, bot = H - 18;
  const x = v => L + (Rr - L) * v / r.end_h;
  const lo = Math.log10(0.5), y = v => bot - (bot - top) * (Math.log10(Math.min(Math.max(v, 0.5), 100)) - lo) / (2 - lo);
  // the first day, when the node is learning and nothing can alarm
  c.fillStyle = "rgba(255,255,255,0.04)"; c.fillRect(x(0), top, x(r.base_h) - x(0), bot - top);
  c.textAlign = "right";
  for (const v of [1, 10, 100]) { rule(c, L, y(v), Rr, y(v), RULE); c.fillStyle = DIM; c.fillText(String(v), L - 6, y(v)); }
  rule(c, L, top, L, bot, RULE); rule(c, Rr, top, Rr, bot, RULE); rule(c, L, bot, Rr, bot, RULE);
  rule(c, L, y(6), Rr, y(6), AMBER, [4, 4]);
  c.textAlign = "left"; c.fillStyle = AMBER; c.fillText("Alarm at 6", Rr + 8, y(6));
  days(c, r, x, H - 7);
  // the trace, white until this bearing's own warning and amber after it
  const j = jobOf(m, key), open = j ? j.open - m.start : Infinity;
  const white = new Path2D(), amber = new Path2D();
  for (let i = 1; i < b.h.length && b.h[i] <= t; i++) {
    if (b.h[i] - b.h[i - 1] > 3) continue;                 // a stoppage is a break in the line, not a slope across it
    const p = b.h[i] > open ? amber : white;
    p.moveTo(x(b.h[i - 1]), y(b.hi[i - 1])); p.lineTo(x(b.h[i]), y(b.hi[i]));
  }
  c.lineWidth = 1.25; c.lineJoin = "round"; c.lineCap = "round";
  c.strokeStyle = INK; c.stroke(white); c.strokeStyle = AMBER; c.stroke(amber);
  // what the board did, when it did it
  const marks = [];
  if (j && j.named != null && j.named - m.start <= t) marks.push([j.named - m.start, `Named ${PART[b.named_as]}`]);
  if (j && j.alarm != null && j.alarm - m.start <= t) marks.push([j.alarm - m.start, "Alarm"]);
  marks.sort((a, z) => a[0] - z[0]);
  for (const [at] of marks) rule(c, x(at), top, x(at), bot, "rgba(255,176,0,0.55)");
  marks.forEach(([at, label], i) => {
    // each label sits to the left of its own line, on a patch of background so no line runs through it
    const tw = c.measureText(label).width, left = x(at) - tw - 10 > L, tx = left ? x(at) - 5 - tw : x(at) + 5, ty = top + 9 + 13 * i;
    c.fillStyle = "rgba(8,10,13,0.88)"; c.fillRect(tx - 3, ty - 6, tw + 6, 12);
    c.textAlign = "left"; c.fillStyle = AMBER; c.fillText(label, tx, ty);
  });
  c.textAlign = "left"; c.fillStyle = DIM; c.fillText("Learning", x(0) + 5, bot - 8);
  if (t > 0 && t < r.end_h) rule(c, x(t), top, x(t), bot, "rgba(255,255,255,0.5)");
  // the pointer reads a moment off both plots at once, since they share the time axis
  const th = hover && hover.x >= L && hover.x <= Rr ? (hover.x - L) / (Rr - L) * r.end_h : null;
  if (th != null && th <= t) {
    rule(c, hover.x, top, hover.x, bot, "rgba(255,255,255,0.28)");
    const i = at(b, th);
    put($("rd-trend"), `${stamp(th)} · ${i < 0 || th < r.base_h ? "learning" : idleAt(b, th) ? "rig stopped" : "health index " + (b.hi[i] >= 99 ? "99+" : b.hi[i].toFixed(2))}`);
  } else put($("rd-trend"), IDLE.trend);
}

let hatching = null;
function hatch(c) {
  if (hatching) return hatching;
  const p = document.createElement("canvas"); p.width = p.height = 6;
  const g = p.getContext("2d");
  g.strokeStyle = "rgba(255,255,255,0.09)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-1, 7); g.lineTo(7, -1); g.stroke();
  return (hatching = c.createPattern(p, "repeat"));
}

// one bearing's waterfall as an image, a pixel to a bin: time across, frequency up
function fallImage(run, key) {
  const id = run + key;
  if (fallImg[id] || !fall[run]) return fallImg[id] || null;
  const C = WF.columns, B = WF.bins, off = (key - 1) * C * B, data = fall[run];
  const cv = document.createElement("canvas"); cv.width = C; cv.height = B;
  const g = cv.getContext("2d"), img = g.createImageData(C, B);
  for (let col = 0; col < C; col++) for (let bin = 0; bin < B; bin++) {
    const v = data[off + col * B + bin], p = 4 * ((B - 1 - bin) * C + col);
    let lum = 0;
    if (v !== 255) {
      // decibels above the spectrum's own median: its noise sits under about 8 dB and stays a dark grain,
      // and a line 18 dB clear is drawn at full white
      const a = Math.min(1, Math.max(0, (v / 254 * WF.db_max - 3.5) / 14.5));
      lum = 10 + 245 * a * a * (0.25 + 0.75 * a);
    }
    img.data[p] = lum * 0.93; img.data[p + 1] = lum * 0.97; img.data[p + 2] = lum; img.data[p + 3] = v === 255 ? 0 : 255;
  }
  g.putImageData(img, 0, 0);
  return (fallImg[id] = cv);
}

function drawFall() {
  const { c, w, h: H } = fit($("cv-fall")), { m, key } = sel, r = R[m.run], b = r.bearings[key], t = Math.max(0, Math.min(T - m.start, r.end_h));
  const { L, Rr } = edges(w), top = 6, bot = H - 18, fmax = WF ? WF.f_max : 600;
  const x = v => L + (Rr - L) * v / r.end_h, y = f => bot - (bot - top) * f / fmax;
  c.fillStyle = "#0a0d11"; c.fillRect(L, top, Rr - L, bot - top);
  const img = WF && fallImage(m.run, Number(key));
  if (img && t > 0) {
    // hatching is a drawing's sign for nothing here: it shows through wherever the rig was stopped and there is no snapshot
    c.fillStyle = hatch(c); c.fillRect(L, top, (Rr - L) * t / r.end_h, bot - top);
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 0, 0, Math.max(1, img.width * t / r.end_h), img.height, L, top, (Rr - L) * t / r.end_h, bot - top);
  }
  c.strokeStyle = RULE; c.lineWidth = 1; c.strokeRect(L + 0.5, top + 0.5, Rr - L, bot - top);
  c.textAlign = "right"; c.fillStyle = DIM;
  for (const f of [0, 200, 400, 600]) c.fillText(String(f), L - 6, Math.min(bot - 4, Math.max(top + 5, y(f))));
  days(c, r, x, H - 7);
  // where each defect would ring, from the bearing's geometry: a ball strikes both races, so it shows at twice its spin
  const Lz = R.lines_hz, j = jobOf(m, key), named = j && j.named != null && j.named - m.start <= t ? b.named_as : null;
  const lines = [["BPFO", Lz.BPFO, "Outer"], ["BSF", 2 * Lz.BSF, w < 520 ? "Roller" : "Rolling el."], ["BPFI", Lz.BPFI, "Inner"]];
  const labels = [];
  for (const [code, f, name] of lines) {
    labels.push({ f, text: `${name} ${f.toFixed(0)}`, hot: named === code, main: true });
    if (2 * f < fmax) labels.push({ f: 2 * f, text: `2× ${name.toLowerCase()}`, hot: named === code });
  }
  labels.sort((a, z) => a.f - z.f);
  let lastY = Infinity;
  for (const l of labels) {
    const at = y(l.f), ty = Math.min(at, lastY - 11);       // labels keep their order and step clear of each other
    lastY = ty;
    const colour = l.hot ? AMBER : l.main ? MID : FAINT;
    c.beginPath(); c.strokeStyle = colour; c.lineWidth = 1;
    c.moveTo(Rr + 1, Math.round(at) + 0.5); c.lineTo(Rr + 5, Math.round(at) + 0.5); c.lineTo(Rr + 9, Math.round(ty) + 0.5); c.stroke();
    c.textAlign = "left"; c.fillStyle = colour; c.fillText(l.text, Rr + 12, ty);
  }
  if (!img) { c.textAlign = "left"; c.fillStyle = DIM; c.fillText(WF === false ? "The spectra did not load." : "Loading spectra", L + 8, top + 12); }
  if (t > 0 && t < r.end_h) rule(c, x(t), top, x(t), bot, "rgba(255,255,255,0.5)");
  const th = hover && hover.x >= L && hover.x <= Rr ? (hover.x - L) / (Rr - L) * r.end_h : null;
  if (th != null && th <= t && img) {
    rule(c, hover.x, top, hover.x, bot, "rgba(255,255,255,0.28)");
    let text = stamp(th);
    if (hover.fall && hover.y >= top && hover.y <= bot) {
      rule(c, L, hover.y, Rr, hover.y, "rgba(255,255,255,0.28)");
      const f = (bot - hover.y) / (bot - top) * fmax, col = Math.min(WF.columns - 1, Math.floor(th / r.end_h * WF.columns)), bin = Math.min(WF.bins - 1, Math.floor(f / fmax * WF.bins));
      const v = fall[m.run][(key - 1) * WF.columns * WF.bins + col * WF.bins + bin];
      text += ` · ${f.toFixed(0)} Hz · ${v === 255 ? "rig stopped, no snapshot" : (v / 254 * WF.db_max).toFixed(0) + " dB above the spectrum's median"}`;
    }
    put($("rd-fall"), text);
  } else put($("rd-fall"), IDLE.fall);
}

/* ---------- jobs, spares, log ---------- */
function renderJobs() {
  const host = $("jobs"), open = JOBS.filter(j => j.open <= T);
  $("jobs-empty").hidden = open.length > 0;
  put($("jobs-count"), open.length ? `${open.length} raised` : "");
  const sig = open.map(j => j.id + (T >= (j.named ?? Infinity)) + (T >= j.m.start + R[j.run].end_h)).join();
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig; host.innerHTML = "";
  for (const j of open.slice().reverse()) {
    const r = R[j.run], stop = j.m.start + r.end_h, named = j.named != null && T >= j.named, done = T >= stop;
    const card = h("div", "job" + (named ? " replace" : "") + (done ? " closed" : ""));
    card.appendChild(h("div", "jmeta", `${j.id} · raised on the snapshot of ${recorded(j.m, j.open - j.m.start)}`));
    card.appendChild(h("h3", null, named ? `Replace bearing ${j.key}, ${j.m.name}` : `Inspect bearing ${j.key}, ${j.m.name}`));
    const dl = h("dl", "res");
    const row = (k, v) => { const r2 = h("div", "res-row"); r2.append(h("dt", null, k), h("dd", null, v)); dl.appendChild(r2); };
    row("Bearing", BEARING);
    row("Finding", named ? `${cap(PART[j.d.named_as])} defect` : `Vibration changed, ${DRIVER[j.d.alarm_driver] || j.d.alarm_driver}`);
    if (named && j.d.evidence) row("Evidence", `${PART[j.d.named_as]} line ${j.d.evidence[{ BPFO: "outer_db", BPFI: "inner_db", BSF: "ball_db" }[j.d.named_as]]} dB, level ${j.d.evidence.level_x}× normal`);
    row("Action", named ? "Draw the spare, change the bearing at the next planned stop" : "Listen and look at the next round, check lubrication and mounting");
    if (done) {
      const sm = r.summary.failed[j.key], lead = stop - j.open;
      // say when a warning came and went before it held, as the results page does
      const held = sm && sm.sustained_lead_h < lead - 24 ? ` Its readings came and went until ${Math.round(sm.sustained_lead_h)} h before, and held from then.` : "";
      row("Outcome", `Raised ${Math.round(lead)} h before the bearing failed.${held} The NASA test ran on to failure, so it was never acted on. On a site the bearing is changed here.`);
    }
    card.appendChild(dl);
    const pr = h("button", null, "Print job card");
    pr.type = "button";
    pr.onclick = e => { e.stopPropagation(); printCard(j); };
    card.appendChild(pr);
    card.onclick = () => { sel = { m: j.m, key: j.key }; pinned = true; render(); };
    host.appendChild(card);
  }
  const sp = $("spares"), need = open.filter(j => j.named != null && T >= j.named && T < j.m.start + R[j.run].end_h).length;
  sp.innerHTML = "";
  const row = h("div", "res-row"); row.append(h("dt", null, BEARING), h("dd", null, need ? `${need} to draw` : "None needed")); sp.appendChild(row);
}

function renderLog() {
  const shown = EVENTS.filter(e => e.t <= T);
  if (shown.length === ui.logCount) return;
  ui.logCount = shown.length;
  const host = $("log"); host.innerHTML = "";
  for (const e of shown.slice().reverse()) {
    const li = h("li", e.key ? "key" : "");
    li.append(h("time", null, stamp(e.t)), document.createTextNode(e.text)); host.appendChild(li);
  }
}

function printCard(j) {
  const named = j.named != null && T >= j.named, pc = $("printcard");
  pc.innerHTML = "";
  pc.appendChild(h("h1", null, `${j.id}: ${named ? "replace bearing" : "inspect"}`));
  pc.appendChild(h("p", null, `VIGIL job card, printed at ${stamp(T)} of the replay of NASA's IMS run-to-failure data`));
  const tb = h("table");
  const row = (k, v) => { const tr = h("tr"); tr.append(h("td", null, k), h("td", null, v)); tb.appendChild(tr); };
  row("Test and bearing", `${j.m.name}, bearing ${j.key}`);
  row("Bearing", BEARING);
  row("Raised", `On the snapshot recorded ${recorded(j.m, j.open - j.m.start)}`);
  row("Finding", named ? `${cap(PART[j.d.named_as])} defect` : `Vibration changed, ${DRIVER[j.d.alarm_driver] || j.d.alarm_driver}`);
  if (named && j.d.evidence) row("Evidence", `Outer race line ${j.d.evidence.outer_db} dB, inner race ${j.d.evidence.inner_db} dB, rolling element ${j.d.evidence.ball_db} dB, overall level ${j.d.evidence.level_x}× normal`);
  row("Action", named ? "Draw the spare and change the bearing at the next planned stop" : "Inspect at the next round");
  pc.appendChild(tb);
  const sign = h("table", "sign");
  for (const k of ["Found when opened", "Done by", "Date", "Officer's signature"]) { const tr = h("tr"); tr.append(h("td", null, k), h("td", null, "")); sign.appendChild(tr); }
  pc.appendChild(sign);
  window.print();
}

/* ---------- the timeline under the scrubber: each test's life so far ---------- */
function drawLanes() {
  const { c, w } = fit($("cv-lanes")), x = t => 5 + (w - 10) * t / END;     // the slider's thumb is 10 px wide
  MACHINES.forEach((m, i) => {
    const r = R[m.run], y = 2 + i * 8, b1 = r.bearings["1"], seen = Math.min(T, m.start + r.end_h);
    c.fillStyle = RULE; c.fillRect(x(m.start), y, x(m.start + r.end_h) - x(m.start), 4);
    if (seen > m.start) {
      c.fillStyle = FAINT; c.fillRect(x(m.start), y, x(Math.min(seen, m.start + r.base_h)) - x(m.start), 4);
      if (seen > m.start + r.base_h) { c.fillStyle = MID; c.fillRect(x(m.start + r.base_h), y, x(seen) - x(m.start + r.base_h), 4); }
      const warned = JOBS.filter(j => j.m === m && j.open <= T).map(j => j.open);
      if (warned.length) { const w0 = Math.min(...warned); c.fillStyle = AMBER; c.fillRect(x(w0), y, x(seen) - x(w0), 4); }
      // the stoppages, as gaps in the bar
      c.fillStyle = "#0a0d11";
      for (let k = 0; k + 1 < b1.h.length && b1.h[k] < seen - m.start; k++) if (b1.h[k + 1] - b1.h[k] > 3) {
        const a = m.start + b1.h[k], z = Math.min(seen, m.start + b1.h[k + 1]);
        c.fillRect(x(a), y - 1, x(z) - x(a), 6);
      }
    }
    if (T >= m.start + r.end_h) { c.fillStyle = "#fff"; c.fillRect(Math.round(x(m.start + r.end_h)) - 1, y - 2, 2, 8); }
  });
}

/* ---------- the clock ---------- */
function render() {
  if (!R || $("board").hidden) return;
  if (!pinned) {                                    // the centre of the desk follows the newest warning
    const open = JOBS.filter(j => j.open <= T), j = open[open.length - 1];
    sel = j ? { m: j.m, key: j.key } : { m: MACHINES[1], key: "1" };
  }
  put($("clock"), stamp(T));
  put($("sitenote"), T >= END - 0.01 ? "Every test has ended" : `${(END - T) / 24 > 1 ? Math.round((END - T) / 24) + " days" : Math.round(END - T) + " h"} of data left`);
  $("scrub").value = Math.round(10000 * T / END);
  renderFleet(); renderPoint(); drawTrend(); drawFall(); renderJobs(); renderLog(); drawLanes();
}
function frame(now) {
  if (playing && !$("board").hidden) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    T = Math.min(END, T + dt * speed);
    if (T >= END) { playing = false; $("play").textContent = "Replay"; }
    render();
  }
  last = now;
  requestAnimationFrame(frame);
}
function toggle() {
  if (!R) return;
  if (T >= END) { T = 0; ui.logCount = -1; $("jobs").dataset.sig = ""; playing = true; }
  else playing = !playing;
  $("play").textContent = playing ? "Pause" : "Play";
  render();
}
$("play").onclick = toggle;
$("scrub").oninput = () => { if (!R) return; T = END * $("scrub").value / 10000; ui.logCount = -1; if (T < END) $("play").textContent = playing ? "Pause" : "Play"; render(); };
document.querySelectorAll(".speed .btn").forEach(b => b.onclick = () => {
  speed = +b.dataset.speed;
  document.querySelectorAll(".speed .btn").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
});
$("pt-follow").onclick = () => { pinned = false; render(); };
for (const id of ["cv-trend", "cv-fall"]) {
  const cv = $(id);
  cv.addEventListener("pointermove", e => { const box = cv.getBoundingClientRect(); hover = { fall: id === "cv-fall", x: e.clientX - box.left, y: e.clientY - box.top }; if (!playing) render(); });
  cv.addEventListener("pointerleave", () => { hover = null; if (!playing) render(); });
}
addEventListener("keydown", e => {
  if (e.code !== "Space" || $("board").hidden || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(e.target.tagName)) return;
  e.preventDefault(); toggle();
});
new ResizeObserver(() => render()).observe($("point-pane"));
addEventListener("resize", () => render());

/* ---------- the three views ---------- */
const VIEWS = ["board", "handset", "recording"];
const FOOT = {
  board: "Replay of NASA's IMS run-to-failure recordings. Every reading, warning and named part is the analysis's own result for that snapshot.",
  handset: "One node, read over Bluetooth, the USB cable or the bench. No board is built yet: the bench node is the firmware itself, on NASA's recordings.",
  recording: "The node's method, run in this browser on raw vibration. A file you choose is read in this tab and never leaves it.",
};
function show() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "board";
  for (const id of VIEWS) $(id).hidden = id !== v;
  document.querySelectorAll(".views a").forEach(a => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("status-left").textContent = FOOT[v];
  scrollTo(0, 0);
  if (v === "handset" && window.VigilHandset) window.VigilHandset.open();
  if (v === "board") { last = 0; render(); }
}
addEventListener("hashchange", show);
addEventListener("DOMContentLoaded", show);

/* ---------- start ---------- */
fetch("data/replay.json").then(r => r.json()).then(rep => {
  R = rep;
  END = Math.max(...MACHINES.map(m => m.start + R[m.run].end_h));
  buildEvents(); buildFleet();
  playing = true; $("play").textContent = "Pause";       // an active demonstration: it is running when it is first seen
  render();
  requestAnimationFrame(frame);
  // the spectra are the heavy part and the board is useful without them, so they follow
  return fetch("data/waterfall.json").then(r => r.json()).then(meta => {
    WF = meta;
    return Promise.all(MACHINES.map(m => fetch(`data/waterfall-${m.run}.bin`).then(r => r.arrayBuffer()).then(buf => { fall[m.run] = new Uint8Array(buf); render(); })));
  }).catch(() => { WF = false; render(); });
}).catch(() => { $("clock").textContent = "No data"; $("pt-state").textContent = "The board's data did not load. Reload the page."; });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

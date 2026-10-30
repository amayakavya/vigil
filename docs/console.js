/* VIGIL's maintenance board, run on NASA's three run-to-failure tests.
   Each test is one shaft with four bearings, each bearing one measuring point.
   Every status, warning and name is the analysis's own result for that bearing
   (data/replay.json), and each card shows when its snapshot was recorded. The
   only arrangement is that the three tests start together on the replay clock. */
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
const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const stamp = t => { const d = Math.floor(t / 24), hh = Math.floor(t % 24), mm = Math.floor((t * 60) % 60); return `Day ${d + 1}, ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; };
const cap = s => s[0].toUpperCase() + s.slice(1);
// when the snapshot at test time t was actually recorded, from the test's own start
function recorded(m, t) {
  const d = new Date(Date.parse(R[m.run].start + "Z") + t * 3600e3);
  return d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

let R = null, END = 0, T = 0, speed = 24, playing = false, last = 0;
let EVENTS = [], JOBS = [];

function hiAt(b, t) {
  // the analysis's health index at or just before local time t (the series is max-pooled for size)
  let lo = 0, hi = b.h.length - 1;
  if (t < b.h[0]) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b.h[mid] <= t) lo = mid; else hi = mid - 1; }
  return b.hi[lo];
}

// NASA's tests stopped overnight and over weekends; a stretch of more than
// three hours with no reading is the machine not running
function idleAt(b, t) {
  let lo = 0, hi = b.h.length - 1;
  if (t < b.h[0]) return false;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b.h[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo + 1 < b.h.length && b.h[lo + 1] - b.h[lo] > 3 && t - b.h[lo] > 0.5;
}

function pointStatus(run, key, t) {
  const r = R[run], d = r.bearings[key];
  const idle = idleAt(d, t);
  if (t < 24) return idle ? { text: "Not running. Learning resumes when it starts.", cls: "quiet", idle } : { text: "Learning its normal", cls: "quiet" };
  const s = latched(run, key, t);
  if (!idle) return s;
  // a warning stands until a mechanic clears it, running or not
  return s.cls === "warn" ? { text: "Not running. " + s.text.replace("Warning:", "Warning stands:"), cls: "warn", idle } : { text: "Not running, no readings", cls: "quiet", idle };
}

function latched(run, key, t) {
  const r = R[run], d = r.bearings[key];
  const named = d.named_h != null && t >= d.named_h, alarmed = d.alarm_h != null && t >= d.alarm_h;
  const mine = n => n == null || String(n) === key;
  if (named && mine(d.named_loudest)) return { text: `Warning: ${PART[d.named_as]} defect. Replace the bearing.`, cls: "warn" };
  if (alarmed && mine(d.loudest_at_alarm)) return { text: "Warning: vibration has changed. Inspect, part not named yet.", cls: "warn" };
  if (named || alarmed) return { text: `Hearing bearing ${named ? d.named_loudest : d.loudest_at_alarm}. No action here.`, cls: "quiet" };
  return { text: "Normal", cls: "" };
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

/* ---------- drawing ---------- */
function spark(svg, b, t) {
  svg.innerHTML = "";
  const W = 150, H = 28, span = 72, from = Math.max(0, t - span);
  const x = v => (v - from) / span * W, y = v => H - 2 - Math.min(v, 30) / 30 * (H - 4);
  el("line", { x1: 0, x2: W, y1: y(6), y2: y(6), stroke: "rgba(255,255,255,0.28)", "stroke-dasharray": "3 3" }, svg);
  let p = "", prev = null;
  for (let i = 0; i < b.h.length; i++) {
    if (b.h[i] < from) continue;
    if (b.h[i] > t) break;
    // a stoppage is a break in the line, not a slope across it
    const jump = prev != null && b.h[i] - prev > 3;
    p += (!p || jump ? "M" : "L") + x(b.h[i]).toFixed(1) + " " + y(b.hi[i]).toFixed(1);
    prev = b.h[i];
  }
  if (p) el("path", { d: p, fill: "none", stroke: "rgba(242,243,245,0.9)", "stroke-width": 1 }, svg);
}

const ui = { machines: [], logCount: -1 };
function buildMachines() {
  const host = $("machines");
  for (const m of MACHINES) {
    const box = h("section", "machine"), head = h("div", "mhead");
    const name = h("b", null, m.name), sub = h("span");
    head.append(name, sub); box.appendChild(head);
    const points = [];
    for (const key of ["1", "2", "3", "4"]) {
      const row = h("div", "point"), pn = h("span", "pn", `Bearing ${key}`), st = h("span", "st"), hi = h("span", "hi");
      const sp = el("svg", { class: "spark", viewBox: "0 0 150 28", preserveAspectRatio: "none", "aria-hidden": "true" });
      row.append(pn, st, sp, hi); box.appendChild(row);
      points.push({ row, st, hi, sp, key });
    }
    host.appendChild(box);
    ui.machines.push({ m, box, sub, points });
  }
}

function render() {
  $("clock").textContent = stamp(T);
  $("sitenote").textContent = T >= END - 0.01 ? "Every test has ended" : `${(END - T) / 24 > 1 ? Math.round((END - T) / 24) + " days" : Math.round(END - T) + " h"} of data left`;
  $("scrub").value = Math.round(10000 * T / END);
  for (const u of ui.machines) {
    const r = R[u.m.run], t = T - u.m.start;
    let warn = false;
    if (t < 0) u.sub.textContent = `Starts at ${stamp(u.m.start)}`;
    else if (t >= r.end_h) u.sub.textContent = `Test ended ${recorded(u.m, r.end_h)}, bearing failed`;
    else u.sub.textContent = idleAt(r.bearings["1"], t) ? `Rig stopped, no readings. ${recorded(u.m, t)}` : `Recording of ${recorded(u.m, t)}`;
    for (const p of u.points) {
      const b = r.bearings[p.key];
      if (t < 0) { p.st.textContent = "Not started yet"; p.row.className = "point quiet"; p.hi.textContent = ""; p.sp.innerHTML = ""; continue; }
      const tt = Math.min(t, r.end_h), s = pointStatus(u.m.run, p.key, tt);
      p.st.textContent = t >= r.end_h ? (b.failed ? `Failed: ${PART[b.failed]}` : "Stopped with the rig") : s.text;
      p.row.className = "point " + (t >= r.end_h ? (b.failed ? "warn" : "quiet") : s.cls);
      warn = warn || s.cls === "warn";
      const v = hiAt(b, tt);
      p.hi.textContent = tt < r.base_h || v == null || s.idle ? "" : v >= 99 ? "99+" : v.toFixed(1);
      spark(p.sp, b, tt);
    }
    u.box.classList.toggle("warn", warn && t < r.end_h);
  }
  renderJobs(); renderLog(); renderLives();
}

function renderJobs() {
  const host = $("jobs"), open = JOBS.filter(j => j.open <= T);
  $("jobs-empty").hidden = open.length > 0;
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
      // say when a warning came and went before it held, as the main page does
      const held = sm && sm.sustained_lead_h < lead - 24 ? ` Its readings came and went until ${Math.round(sm.sustained_lead_h)} h before, and held from then.` : "";
      row("Outcome", `Raised ${Math.round(lead)} h before the bearing failed.${held} The NASA test ran on to failure, so it was never acted on. On a site the bearing is changed here.`);
    }
    card.appendChild(dl);
    const pr = h("button", null, "Print job card");
    pr.onclick = () => printCard(j);
    card.appendChild(pr);
    host.appendChild(card);
  }
  const sp = $("spares");
  const need = open.filter(j => j.named != null && T >= j.named && T < j.m.start + R[j.run].end_h).length;
  sp.innerHTML = "";
  const row = h("div", "res-row"); row.append(h("dt", null, BEARING), h("dd", null, need ? `${need} to draw` : "none needed")); sp.appendChild(row);
}

function renderLog() {
  const shown = EVENTS.filter(e => e.t <= T);
  if (shown.length === ui.logCount) return;
  ui.logCount = shown.length;
  const host = $("log"); host.innerHTML = "";
  for (const e of shown.slice().reverse()) {
    const li = h("li", e.key ? "key" : ""), tm = h("time", null, stamp(e.t));
    li.append(tm, document.createTextNode(e.text)); host.appendChild(li);
  }
}

let livesBuilt = false;
function renderLives() {
  const host = $("lives");
  if (!livesBuilt) {
    for (const m of MACHINES) {
      const r = R[m.run], box = h("div", "life"), svg = el("svg", { viewBox: "0 0 1000 34", preserveAspectRatio: "none", "aria-label": `${m.name} across the replay` });
      box.append(h("b", null, m.name), svg); host.appendChild(box);
      const x = t => t / END * 1000;
      el("rect", { x: 0, y: 14, width: 1000, height: 6, fill: "rgba(255,255,255,0.05)" }, svg);
      el("rect", { x: x(m.start), y: 14, width: x(24), height: 6, fill: "rgba(255,255,255,0.25)" }, svg);
      el("rect", { x: x(m.start + 24), y: 14, width: x(r.end_h - 24), height: 6, fill: "rgba(255,255,255,0.5)" }, svg);
      const b1 = r.bearings["1"];                           // the stoppages, as gaps in the bar
      for (let i = 0; i + 1 < b1.h.length; i++) if (b1.h[i + 1] - b1.h[i] > 3)
        el("rect", { x: x(m.start + b1.h[i]), y: 13, width: x(b1.h[i + 1] - b1.h[i]), height: 8, fill: "#08090d" }, svg);
      const warns = JOBS.filter(j => j.m === m).map(j => j.open);
      if (warns.length) {
        const w0 = Math.min(...warns);
        el("rect", { x: x(w0), y: 10, width: x(m.start + r.end_h - w0), height: 14, fill: "#f2f3f5" }, svg);
        el("text", { x: Math.max(4, x(w0) - 4), y: 8, "text-anchor": "end" }, svg, `warned ${Math.round(m.start + r.end_h - w0)} h ahead`);
      }
      el("line", { x1: x(m.start + r.end_h), x2: x(m.start + r.end_h), y1: 4, y2: 30, stroke: "#fff", "stroke-width": 2 }, svg);
      box.cursor = el("line", { x1: 0, x2: 0, y1: 0, y2: 34, stroke: "rgba(255,255,255,0.6)" }, svg);
    }
    livesBuilt = true;
  }
  for (const b of host.children) if (b.cursor) { const x = T / END * 1000; b.cursor.setAttribute("x1", x); b.cursor.setAttribute("x2", x); }
}

function printCard(j) {
  const r = R[j.run], named = j.named != null && T >= j.named, pc = $("printcard");
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
  [["Found when opened", ""], ["Done by", ""], ["Date", ""], ["Officer's signature", ""]].forEach(([k]) => { const tr = h("tr"); tr.append(h("td", null, k), h("td", null, "")); sign.appendChild(tr); });
  pc.appendChild(sign);
  window.print();
}

/* ---------- clock ---------- */
function frame(now) {
  if (playing) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    T = Math.min(END, T + dt * speed);
    if (T >= END) { playing = false; $("play").textContent = "Replay"; }
    render();
  }
  last = now;
  requestAnimationFrame(frame);
}
$("play").onclick = () => {
  if (T >= END) { T = 0; ui.logCount = -1; $("jobs").dataset.sig = ""; playing = true; }
  else playing = !playing;
  $("play").textContent = playing ? "Pause" : "Play";
  render();
};
$("scrub").oninput = () => { T = END * $("scrub").value / 10000; ui.logCount = -1; render(); };
document.querySelectorAll(".speed .tab").forEach(b => b.onclick = () => {
  speed = +b.dataset.speed;
  document.querySelectorAll(".speed .tab").forEach(x => x.setAttribute("aria-selected", x === b));
});

/* ---------- a real node, over Bluetooth ---------- */
const SVC = "7b1e0001-5c3a-4f6e-9a77-56494749c001", STATUS = "7b1e0002-5c3a-4f6e-9a77-56494749c001";
$("ble").onclick = async () => {
  const out = $("node"); out.hidden = false; out.innerHTML = "";
  const row = (k, v) => { const r = h("div", "res-row"); r.append(h("dt", null, k), h("dd", null, v)); out.appendChild(r); };
  if (!navigator.bluetooth) { row("Bluetooth", "This browser cannot reach Bluetooth. Use Chrome on a computer or an Android phone."); return; }
  try {
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC] }] });
    const srv = await dev.gatt.connect();
    const chr = await (await srv.getPrimaryService(SVC)).getCharacteristic(STATUS);
    const line = new TextDecoder().decode(await chr.readValue());
    const kv = Object.fromEntries(line.split("|").slice(1).map(p => p.split("=")));
    row("Node", kv.id || dev.name);
    row("State", kv.phase === "learning" ? `Learning, ${kv.learned}` : cap(kv.phase || "unknown"));
    row("Health index", kv.hi || "");
    row("Named part", kv.part === "none" ? "None" : cap(kv.part || ""));
    row("Line strengths", `outer ${kv.outer} dB, inner ${kv.inner} dB, rolling element ${kv.ball} dB`);
    dev.gatt.disconnect();
  } catch (e) {
    row("Bluetooth", e.name === "NotFoundError" ? "No node chosen." : `Could not read the node: ${e.message}`);
  }
};

/* ---------- start ---------- */
fetch("data/replay.json").then(r => r.json()).then(rep => {
  R = rep;
  END = Math.max(...MACHINES.map(m => m.start + R[m.run].end_h));
  buildEvents(); buildMachines(); render();
  $("play").textContent = "Play";
  // the site starts when it comes into view, so a visitor sees it from day one
  // instead of arriving at day twenty after reading the header
  const io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting) && T === 0 && !playing) { playing = true; $("play").textContent = "Pause"; io.disconnect(); }
  }, { threshold: 0.6 });
  io.observe($("deck"));
  requestAnimationFrame(frame);
}).catch(() => { $("clock").textContent = "The site data did not load. Reload the page."; });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* VIGIL's handset: one page that reads a node over Bluetooth, the USB cable
   or the bench (the node's firmware in WebAssembly), with the same lines on
   all three (link.js). It shows the node's state and its 48-hour trend, takes
   a spot reading, pulls the raw recording and runs the method on it here
   (vigil.js in worker.js), writes the installation, and keeps the round. */
(() => {
"use strict";
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
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const W80 = "rgba(242,243,245,0.95)", W30 = "rgba(255,255,255,0.3)", W15 = "rgba(255,255,255,0.12)";

const SVC = "7b1e0001-5c3a-4f6e-9a77-56494749c001", STATUS = "7b1e0002-5c3a-4f6e-9a77-56494749c001",
  RX = "7b1e0003-5c3a-4f6e-9a77-56494749c001", TX = "7b1e0004-5c3a-4f6e-9a77-56494749c001";
const VIA = { bench: "demo", ble: "Bluetooth", usb: "cable" }, OVER = { bench: "the demo node", ble: "Bluetooth", usb: "the cable" };
const CODE = { "outer race": "BPFO", "inner race": "BPFI", "rolling element": "BSF" };
const PART = { BPFO: "outer race", BPFI: "inner race", BSF: "rolling element" };
const BEARINGS = { "16/0.331/2.815/15.17": "Rexnord ZA-2115", "9/7.94/39.04/0": "SKF 6205-2RS JEM" };
const INTRO = $("c-note").textContent;

let link = null, via = null, shut = null, now = null, formFilled = false, lastRaw = null, lastTrend = null, lastSes = null;
let bench = null, benchInfo = null, benchStep = -1, running = false, analysis = null, visit = 0;

function note(text, bad) { const n = $("c-note"); n.textContent = text; n.classList.toggle("err", !!bad); }
function fileTime(name, shift = 0) {
  const p = name.split(".").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4] + shift));
  return d.toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function ago(s) { return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`; }
function fitted(s) {
  if (!s.brg) return "";
  const name = BEARINGS[s.brg.join("/")] || `${s.brg[0]} elements of ${s.brg[1]} on ${s.brg[2]}, ${s.brg[3]}°`;
  return `${name}, ${s.rpm} rpm, axis ${"XYZ"[s.axis] || s.axis}`;
}
function stateText(s) {
  if (s.error) return s.error === "psram" ? "Fault: the node has no memory for a snapshot" : `Fault: ${s.error}`;
  if (s.phase === "learning") return `Learning its normal, ${s.learned} of ${s.base}`;
  if (s.phase === "warning") return s.part !== "none" ? `Warning: ${s.part} defect. Replace the bearing.` : "Warning: vibration has changed. Inspect.";
  return s.phase === "normal" ? "Healthy" : cap(s.phase);
}

/* ---------- three ways to reach a node ---------- */
function lost(why) { if (link) disconnect(simple ? "#/simple" : "#/connect").then(() => (simple ? tell($("q-note"), why, true) : note(why, true))); }
function tell(el, text, bad) { el.textContent = text; el.classList.toggle("err", !!bad); }

function openBench() {
  return new Promise((resolve, reject) => {
    bench = new Worker("bench.js");
    bench.onerror = () => reject(new Error("The bench node could not start."));
    bench.onmessage = e => {
      const m = e.data;
      if (m.line !== undefined) link.feed(m.line + "\n");
      else if (m.error) reject(new Error(m.error));
      else if (m.ready) { benchInfo = m; benchStep = -1; benchNote(false); resolve(); }
      else if (m.step !== undefined) { benchStep = m.step; benchNote(m.end); if (m.reset) { hideResults(); refresh().catch(() => {}); } if (bench.next) { bench.next(m); bench.next = null; } }
    };
    const w = bench;
    link.send = line => w.postMessage({ line });
    shut = () => { w.terminate(); bench = null; running = false; };
  });
}

async function openBle() {
  if (!navigator.bluetooth) throw new Error("This browser cannot reach Bluetooth. Chrome or Edge on Android or a computer can. An iPhone's own browser does not allow it.");
  const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC] }] });
  dev.addEventListener("gattserverdisconnected", () => lost("The node went back to sleep, or out of range. Press its button and connect again."));
  shut = () => { if (dev.gatt.connected) dev.gatt.disconnect(); };
  const svc = await (await dev.gatt.connect()).getPrimaryService(SVC);
  // the status is protected, so reading it is what makes the phone ask for the passkey on the node's label
  await (await svc.getCharacteristic(STATUS)).readValue();
  const tx = await svc.getCharacteristic(TX), rx = await svc.getCharacteristic(RX);
  const dec = new TextDecoder(), enc = new TextEncoder();
  tx.addEventListener("characteristicvaluechanged", e => link.feed(dec.decode(e.target.value, { stream: true })));
  await tx.startNotifications();
  link.send = line => (rx.writeValueWithResponse || rx.writeValue).call(rx, enc.encode(line));
}

async function openUsb() {
  if (!navigator.serial) throw new Error("This browser cannot open a serial port. Chrome or Edge on a computer can.");
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });
  const reader = port.readable.getReader(), writer = port.writable.getWriter();
  const dec = new TextDecoder(), enc = new TextEncoder();
  let open = true;
  (async () => {
    for (;;) { const { value, done } = await reader.read(); if (done) break; link.feed(dec.decode(value, { stream: true })); }
  })().catch(() => {}).then(() => { if (open) lost("The cable was unplugged, or the node went to sleep."); });
  shut = async () => { open = false; try { await reader.cancel(); writer.releaseLock(); await port.close(); } catch { /* already gone */ } };
  link.send = line => writer.write(enc.encode(line + "\n"));
}

let opening = false;
async function connect(kind) {
  if (opening) return;
  opening = true;
  try { await connectTo(kind); } finally { opening = false; }
}
async function connectTo(kind) {
  await disconnect();
  // the answer goes back to the screen that asked: the simple version's, or the full version's two menus
  const say = (t, bad) => tell(simple ? $("q-note") : kind === "bench" ? $("t-note") : $("c-note"), t, bad);
  say(kind === "bench" ? "Starting the demonstration." : kind === "ble" ? "Choose the sensor. The phone will ask for the passkey on its label." : "Choose the sensor's serial port.");
  try {
    link = new VigilLink.Link(() => { throw new Error("Not connected."); });
    link.onstatus = showStatus;
    await { bench: openBench, ble: openBle, usb: openUsb }[kind]();
    via = kind; visit = Date.now();
    // shown before it is filled, so the charts are drawn at the width they will have
    $("node").hidden = false; $("node-tools").hidden = false; $("bench").hidden = kind !== "bench";
    $("c-via").textContent = kind === "bench" ? "Demo node, in this app" : kind === "ble" ? "Over Bluetooth" : "Over the USB cable";
    await refresh();
    say("");
    location.hash = simple ? "#/check" : "#/node";   // on to the verdict, or to the node's own menu
    if (window.VigilApp) window.VigilApp.show();
  } catch (e) {
    await disconnect();
    say(e.name === "NotFoundError" ? "No node chosen." : e.name === "SecurityError" || e.name === "NotAllowedError" ? "The browser did not allow it. Tap the row again." : e.message, true);
  }
}

async function disconnect(to) {
  const s = shut;
  shut = null; link = null; via = null; now = null; formFilled = false; lastRaw = null; running = false;
  if (s) await s();
  $("node").hidden = true; $("node-tools").hidden = true; $("c-via").textContent = "";
  hideResults();
  note(INTRO);
  if (window.VigilApp) window.VigilApp.panel("", false);
  if (location.hash === "#/node" || location.hash === "#/check") { location.hash = to || (simple ? "#/simple" : "#/home"); }
}
function hideResults() { $("spot").hidden = true; $("ev").hidden = true; $("a-err").hidden = true; $("i-note").textContent = ""; }

async function refresh() {
  showStatus(await link.status());
  drawTrend(await link.trend());
}

/* ---------- the node, as it stands ---------- */
function showStatus(s) {
  const newSnap = now && s.snap !== now.snap;
  now = s;
  $("n-title").textContent = `Node ${s.id}`;
  $("s-state").textContent = stateText(s);
  $("s-state").className = "state" + (s.phase === "warning" || s.error ? " warn" : s.phase === "learning" ? " quiet" : "");
  $("s-hi").textContent = s.hi != null && s.hi >= 0 ? s.hi.toFixed(2) : s.read === "stopped" ? "Machine stopped" : s.phase === "learning" ? "None while it learns" : "None yet";
  $("s-part").textContent = s.part === "none" ? "None" : cap(s.part);
  const read = s.read === "ok" || s.read === "stopped";
  $("s-lines").textContent = read ? lines1(s) : "";
  $("s-level").textContent = read ? `${s.rms_g.toFixed(4)} g RMS` : "";
  $("s-last").textContent = s.read === "none" ? "None taken yet" : s.read === "void" ? `Number ${s.snap}, ${ago(s.age)}: the capture had a gap` : `Number ${s.snap}, ${ago(s.age)}, ${s.fs.toLocaleString("en-IN")} Hz measured`;
  $("s-fit").textContent = fitted(s);
  if (!formFilled && s.brg) {
    formFilled = true;
    $("i-id").value = s.id; $("i-rpm").value = s.rpm; $("i-axis").value = String(s.axis); $("i-key").value = "";
    const key = s.brg.join("/");
    $("i-brg").value = BEARINGS[key] ? key : "custom";
    [$("i-n").value, $("i-d").value, $("i-p").value, $("i-a").value] = s.brg;
    customFields();
  }
  showJob(s);
  logRound(s);
  showVerdict(s);
  // a node that has just taken its ten-minute snapshot has a new point for the trend
  if (newSnap && link) link.trend().then(drawTrend).catch(() => {});
}

function drawTrend(tr) {
  lastTrend = tr;
  const svg = $("trend"); svg.innerHTML = "";
  const W = Math.max(300, Math.round(svg.parentNode.clientWidth || 820)), H = 170, m = { l: 8, r: 8, t: 16, b: 24 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const vals = tr.hi.filter(v => v != null), top = Math.max(8, Math.min(40, 1.15 * Math.max(0, ...vals)));
  const x = i => m.l + (W - m.l - m.r) * (i + 288 - tr.hi.length) / 287, y = v => m.t + (H - m.t - m.b) * (1 - Math.min(v, top) / top);
  el("line", { x1: m.l, x2: W - m.r, y1: y(6), y2: y(6), stroke: W30, "stroke-dasharray": "3 4" }, svg);
  el("text", { x: W - m.r, y: y(6) - 5, "text-anchor": "end" }, svg, "alarm at 6");
  let p = "", pen = false;
  tr.hi.forEach((v, i) => {
    // a stopped machine and a learning node are breaks in the line, not zeros
    if (v == null) { pen = false; return; }
    p += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pen = true;
  });
  if (p) el("path", { d: p, fill: "none", stroke: W80, "stroke-width": 1.2 }, svg);
  el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: W15 }, svg);
  el("text", { x: m.l, y: H - 7 }, svg, "48 h ago");
  el("text", { x: (m.l + W - m.r) / 2, y: H - 7, "text-anchor": "middle" }, svg, "24 h");
  el("text", { x: W - m.r, y: H - 7, "text-anchor": "end" }, svg, "last snapshot");
  const stopped = tr.hi.filter((v, i) => v == null && !tr.learning[i]).length, learning = tr.learning.filter(Boolean).length;
  $("trend-cap").textContent = !tr.hi.length ? "No snapshots logged yet. The trend is kept in the node while it has power, and starts again after a power cut."
    : `The node's own log: ${tr.hi.length} snapshots, one every ten minutes${learning ? `, ${learning} of them while learning` : ""}${stopped ? `, ${stopped} with the machine stopped` : ""}. The health index is the worst of six readings against this machine's normal.`;
}

/* ---------- the bench node's clock ---------- */
function benchNote(end) {
  const f = benchInfo.files;
  $("b-note").textContent = benchStep < 0
    ? `The demo node has run from the start of the test to the snapshot of ${fileTime(f[0], -10)}. Each press gives it the next recording, as its ten-minute wake would.`
    : `Recording ${benchStep + 1} of ${f.length}: the snapshot of ${fileTime(f[benchStep])}.${end ? " The demo recordings end here." : ""}`;
  $("b-next").disabled = !!end; $("b-run").disabled = !!end && !running;
}
function advance() { return new Promise(res => { bench.next = res; bench.postMessage({ advance: true }); }); }
$("b-next").onclick = () => { if (bench && !running) advance(); };
$("b-run").onclick = async () => {
  if (!bench) return;
  if (running) { running = false; return; }
  running = true; $("b-run").textContent = "Pause";
  while (running && bench) { const m = await advance(); if (m.end) break; await new Promise(r => setTimeout(r, 700)); }
  running = false; $("b-run").textContent = "Run on";
  if (bench) benchNote(benchStep + 1 >= benchInfo.files.length);
};
$("b-reset").onclick = () => { if (bench) { running = false; bench.postMessage({ reset: true }); } };

/* ---------- at the machine ---------- */
function working(btn, label, fn) {
  return async () => {
    if (!link || btn.disabled) return;
    const was = btn.textContent;
    btn.disabled = true; btn.classList.add("wait"); btn.textContent = label; $("a-err").hidden = true;
    try { await fn(btn); }
    catch (e) { $("a-err").textContent = e.message; $("a-err").hidden = false; }
    finally { btn.disabled = false; btn.classList.remove("wait"); btn.textContent = was; }
  };
}

$("a-spot").onclick = working($("a-spot"), "Reading", async () => {
  const p = await link.spot();
  $("spot").hidden = false;
  $("p-hi").textContent = p.read === "stopped" ? "Machine stopped" : p.hi >= 0 ? p.hi.toFixed(2) : "No normal to score against yet";
  $("p-points").textContent = p.points === "none" ? "No part: no line stands 10 dB clear" : cap(p.points);
  $("p-lines").textContent = lines1(p);
});

function ordersOf(g) {
  const [n, d, p, a] = g, r = d / p * Math.cos(a * Math.PI / 180);
  return { BPFO: n / 2 * (1 - r), BPFI: n / 2 * (1 + r), BSF: p / (2 * d) * (1 - r * r), FTF: 0.5 * (1 - r) };
}
function analyse(x, fs, rpm, orders) {
  return new Promise((resolve, reject) => {
    if (!analysis) analysis = new Worker("worker.js");
    analysis.onmessage = e => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)));
    analysis.onerror = e => reject(new Error(e.message || "The analysis could not start."));
    analysis.postMessage({ x, fs, rpm, orders }, [x.buffer]);
  });
}
const three = s => `outer ${s.BPFO.toFixed(2)} dB, inner ${s.BPFI.toFixed(2)} dB, rolling element ${s.BSF.toFixed(2)} dB`;
const lines1 = s => `outer ${s.outer.toFixed(1)} dB, inner ${s.inner.toFixed(1)} dB, rolling element ${s.ball.toFixed(1)} dB`;

$("a-raw").onclick = working($("a-raw"), "Receiving", async btn => {
  const raw = await link.raw(f => { btn.textContent = `Receiving ${Math.round(100 * f)}%`; });
  btn.textContent = "Analysing";
  const r = await analyse(Float64Array.from(raw.q, v => v * raw.scale), raw.fs, raw.rpm, ordersOf(now.brg));
  lastRaw = raw;
  const worst = Math.max(...["BPFO", "BPFI", "BSF"].map(k => Math.abs(r.scores[k] - raw.scores[k])));
  const band = r.band[0] === raw.band[0] && r.band[1] === raw.band[1];
  $("ev").hidden = false;
  $("e-agree").textContent = band && worst < 0.01 ? `Agree, within ${worst.toFixed(4)} dB` : `Differ, by ${worst.toFixed(2)} dB`;
  $("e-agree").classList.toggle("err", !(band && worst < 0.01));
  $("e-rec").textContent = `${raw.spot ? "Spot reading" : `Snapshot ${raw.snap}`}: ${raw.n.toLocaleString("en-IN")} samples, ${(raw.n / raw.fs).toFixed(2)} s, checksum good`;
  $("e-node").textContent = three(raw.scores);
  $("e-phone").textContent = three(r.scores);
  const hz = b => `${Math.round(b[0]).toLocaleString("en-IN")} to ${Math.round(b[1]).toLocaleString("en-IN")} Hz`;
  $("e-band").textContent = band ? hz(r.band) : `${hz(r.band)} here, ${hz(raw.band)} on the node`;
  $("e-verdict").textContent = r.verdict ? `${cap(PART[r.verdict])} defect` : "No part: no line stands 10 dB clear";
  drawSES(r);
  $("n-ses-cap").textContent = "Squared envelope spectrum of the node's own samples, computed on this device. Dashed lines are where each defect would show, from the bearing's geometry. One recording does not raise a warning: the node names a part when the same line stands 10 dB clear on three snapshots in a row.";
});

function drawSES(r) {
  const svg = $("n-ses"); svg.innerHTML = ""; lastSes = r;
  const W = Math.max(300, Math.round(svg.parentNode.clientWidth || 820)), H = W < 600 ? 230 : 250, m = { l: 8, r: 8, t: 40, b: 28 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const x = f => m.l + (W - m.l - m.r) * f / r.top, y = v => m.t + (H - m.t - m.b) * (1 - Math.min(v, 1.1) / 1.1);
  const marks = [[r.lines.BPFO, "outer"], [r.lines.BPFI, "inner"], [2 * r.lines.BSF, "rolling element"]].sort((a, b) => a[0] - b[0]);
  marks.forEach(([f, lab], i) => {
    for (let k = 1; k * f < r.top; k++) el("line", { x1: x(k * f), x2: x(k * f), y1: m.t - 4 + (k > 1 ? 10 : 0), y2: H - m.b, stroke: k > 1 ? W15 : W30, "stroke-dasharray": "3 4" }, svg);
    const right = x(f) > W * 0.62;
    el("text", { x: x(f) + (right ? -4 : 4), y: 12 + i * 12, "text-anchor": right ? "end" : "start" }, svg, `${lab} ${f.toFixed(1)} Hz`);
  });
  let p = "";
  r.f.forEach((f, i) => { p += (i ? "L" : "M") + x(f).toFixed(1) + " " + y(r.s[i]).toFixed(1); });
  el("path", { d: p, fill: "none", stroke: W80, "stroke-width": 1 }, svg);
  el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: W15 }, svg);
  let stepHz = r.top > 1500 ? 500 : r.top > 600 ? 200 : 100;
  if (W < 600) stepHz *= 2;
  for (let f = stepHz; f < r.top; f += stepHz) el("text", { x: x(f), y: H - 8, "text-anchor": "middle" }, svg, f.toLocaleString("en-IN"));
  el("text", { x: W - m.r, y: H - 8, "text-anchor": "end" }, svg, "Hz");
}

function save(name, type, parts) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(parts, { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// the recording as a 16-bit WAV of the sensor's own counts, which the diagnosis tool on the live page reads back
$("e-save").onclick = () => {
  if (!lastRaw || !now) return;
  const q = lastRaw.q, v = new DataView(new ArrayBuffer(44 + 2 * q.length)), rate = Math.round(lastRaw.fs);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + 2 * q.length, true); tag(8, "WAVE"); tag(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, 2 * rate, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, 2 * q.length, true);
  for (let i = 0; i < q.length; i++) v.setInt16(44 + 2 * i, q[i], true);
  save(`${now.id}-${lastRaw.spot ? "spot" : "snapshot-" + lastRaw.snap}.wav`, "audio/wav", [v.buffer]);
};

/* ---------- the job card ---------- */
// a button that asks to be pressed twice before it does something that cannot be taken back
function twice(btn, label, fn) {
  let armed = 0;
  const was = btn.textContent;
  btn.onclick = async () => {
    if (Date.now() - armed > 6000) { armed = Date.now(); btn.textContent = label; setTimeout(() => { if (btn.textContent === label) btn.textContent = was; }, 6000); return; }
    armed = 0; btn.textContent = was;
    await fn();
  };
}
const evidence = r => `Health index ${r.hi != null && r.hi >= 0 ? r.hi.toFixed(2) : "not scored"} against an alarm of 6. Lines: ${lines1(r)}. Level ${r.rms_g.toFixed(4)} g RMS.`;
function jobRows(s, why) {
  const named = s.part !== "none";
  return [
    ["Node", s.id],
    ["Bearing", fitted(s)],
    ["Finding", named ? `${cap(s.part)} defect` : "Vibration has changed, part not named yet"],
    // the node names a part on three readings in a row: this is the third, the one that raised it
    ...(why ? [["When it was raised", `Snapshot ${why.snap}, ${ago(why.ago)}. ${evidence(why)}`]] : []),
    ["Latest snapshot", evidence(s)],
    ["Action", named ? "Draw the spare and change the bearing at the next planned stop" : "Listen and look at the next round, check lubrication and mounting"],
  ];
}
async function showJob(s) {
  const wrap = $("jobwrap"), warn = s.phase === "warning";
  if (!warn) { wrap.hidden = true; wrap.dataset.sig = ""; return; }
  const sig = [s.id, s.part, s.alarm, s.snap].join();
  if (wrap.dataset.sig === sig) return;
  wrap.dataset.sig = sig;
  const why = link ? await link.why().catch(() => null) : null;
  if (wrap.dataset.sig !== sig) return;          // a newer reading came in while the node was asked
  wrap.hidden = false;
  card0 = { s, why, read: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) };
  const named = s.part !== "none", host = $("job"), card = h("div", "job" + (named ? " replace" : ""));
  const read = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  host.innerHTML = "";
  card.appendChild(h("div", "jmeta", `Read ${read} from ${OVER[via]}`));
  card.appendChild(h("h3", null, named ? `Replace the bearing, ${s.id}` : `Inspect, ${s.id}`));
  const dl = h("dl", "res"), rows = jobRows(s, why);
  for (const [k, v] of rows.slice(1)) { const r = h("div", "res-row"); r.append(h("dt", null, k), h("dd", null, v)); dl.appendChild(r); }
  card.appendChild(dl);
  const bar = h("div", "links"), pr = h("button", null, "Print job card"), sh = h("button", null, "Share"), cl = h("button", null, "Clear after the repair");
  pr.onclick = () => printCard(s, read, why);
  sh.onclick = () => shareCard(sh, s, read, why);
  twice(cl, "Press again to clear", async () => { try { await link.clear(); await refresh(); } catch (e) { $("a-err").textContent = e.message; $("a-err").hidden = false; } });
  bar.append(pr, sh, cl); card.appendChild(bar); host.appendChild(card);
}
async function shareCard(btn, s, read, why) {
  const text = [`VIGIL job card, read ${read}`, ...jobRows(s, why).map(([k, v]) => `${k}: ${v}`)].join("\n"), was = btn.textContent;
  try {
    if (navigator.share) await navigator.share({ title: `VIGIL job card, ${s.id}`, text });
    else { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; setTimeout(() => { btn.textContent = was; }, 2000); }
  } catch { /* the share sheet was closed */ }
}

/* ---------- the simple version: one verdict ---------- */
let simple = false, card0 = null;
// what the sensor's state means for the person standing at the machine, in one word and one sentence
function verdict(s) {
  if (s.error) return { word: "Sensor fault", cls: "warn", line: "The sensor cannot take a reading. Report it to the workshop." };
  if (s.phase === "learning") return { word: "Learning", cls: "quiet", line: `It is learning this machine's normal: ${s.learned} of ${s.base} readings. Nothing to do yet.` };
  if (s.phase === "warning") return s.part !== "none"
    ? { word: "Replace bearing", cls: "warn solid", line: `${cap(s.part)} defect. Tell the workshop to change the bearing at the next planned stop.` }
    : { word: "Check soon", cls: "warn", line: "Its vibration has changed. Tell the workshop to inspect it at the next round." };
  if (s.read === "stopped") return { word: "Not running", cls: "quiet", line: "The machine was stopped at the last reading. Nothing to report." };
  return { word: "Healthy", cls: "", line: "Nothing to do. It checks itself again in ten minutes." };
}
function showVerdict(s) {
  const v = verdict(s), warn = s.phase === "warning", scored = s.hi != null && s.hi >= 0 && s.phase !== "learning";
  $("q-id").textContent = `Sensor ${s.id}`;
  $("q-via").textContent = via === "bench" ? "Demonstration, on recorded data" : via === "ble" ? "Over Bluetooth" : "Over the USB cable";
  $("q-box").className = "verdict " + v.cls;
  $("q-word").textContent = v.word; $("q-line").textContent = v.line;
  // the gauge runs 0 to 12 with the alarm line in the middle, and a score beyond it rests at the end
  $("q-pin").style.left = `${scored ? Math.min(100, s.hi / 12 * 100) : 0}%`;
  $("q-pin").hidden = !scored;
  $("q-score").textContent = scored ? s.hi.toFixed(2) : s.phase === "learning" ? "Learning" : "None";
  $("q-part").textContent = s.part === "none" ? "None" : cap(s.part);
  $("q-last").textContent = s.read === "none" ? "None yet" : ago(s.age);
  $("q-send").hidden = !warn; $("q-print").hidden = !warn;
  $("q-next").textContent = via === "bench" ? "Next reading, ten minutes on" : "Check again";
  if (via !== "bench") $("q-step").textContent = "";
}
$("q-check").onclick = () => {
  simple = true;
  $("q-next").disabled = false; $("q-step").textContent = "";
  if (!navigator.bluetooth) { tell($("q-note"), "This phone's browser cannot use Bluetooth. Chrome on an Android phone can. On a computer, use the USB cable.", true); return; }
  connect("ble");
};
$("q-usb").onclick = () => {
  simple = true;
  if (!navigator.serial) { tell($("q-note"), "This browser cannot open a serial port. Chrome or Edge on a computer can.", true); return; }
  connect("usb");
};
$("q-demo").onclick = () => { simple = true; $("q-next").disabled = false; $("q-step").textContent = ""; connect("bench"); };
$("q-next").onclick = async () => {
  if (!link) return;
  const btn = $("q-next");
  btn.disabled = true;
  try {
    if (bench) {
      const m = await advance();
      $("q-step").textContent = `Recording ${benchStep + 1} of ${benchInfo.files.length}, taken ${fileTime(benchInfo.files[benchStep])}.${m.end ? " That is the last one. Press Done to start over." : ""}`;
      if (m.end) return;                     // nothing further to give it
    } else await refresh();
  } catch (e) { tell($("q-step"), e.message, true); }
  finally { btn.disabled = bench ? benchStep + 1 >= benchInfo.files.length : false; }
};
// the job card is asked for when the warning is first seen; if the button is pressed sooner, it is built on the spot
async function card() {
  if (card0 && now && card0.s.id === now.id && card0.s.snap === now.snap) return card0;
  const why = link ? await link.why().catch(() => null) : null;
  return { s: now, why, read: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) };
}
$("q-send").onclick = async () => { if (now) { const c = await card(); shareCard($("q-send"), c.s, c.read, c.why); } };
$("q-print").onclick = async () => { if (now) { const c = await card(); printCard(c.s, c.read, c.why); } };
$("q-done").onclick = () => disconnect();

function printCard(s, read, why) {
  const pc = $("printcard"), named = s.part !== "none";
  pc.innerHTML = "";
  pc.appendChild(h("h1", null, `${s.id}: ${named ? "replace bearing" : "inspect"}`));
  pc.appendChild(h("p", null, `VIGIL job card, read from the node ${read}`));
  const tb = h("table");
  for (const [k, v] of jobRows(s, why)) { const tr = h("tr"); tr.append(h("td", null, k), h("td", null, v)); tb.appendChild(tr); }
  pc.appendChild(tb);
  const sign = h("table", "sign");
  for (const k of ["Found when opened", "Done by", "Date", "Officer's signature"]) { const tr = h("tr"); tr.append(h("td", null, k), h("td", null, "")); sign.appendChild(tr); }
  pc.appendChild(sign);
  window.print();
}

/* ---------- installation ---------- */
function customFields() { document.querySelectorAll("[data-custom]").forEach(f => { f.hidden = $("i-brg").value !== "custom"; }); }
$("i-brg").onchange = customFields;
function wanted() {
  const brg = $("i-brg").value === "custom" ? [$("i-n"), $("i-d"), $("i-p"), $("i-a")].map(e => e.value.trim()).join("/") : $("i-brg").value;
  const out = [];
  if ($("i-id").value.trim() !== now.id) out.push(["id", $("i-id").value.trim(), false]);
  if (brg.split("/").map(Number).join("/") !== now.brg.join("/")) out.push(["brg", brg, true]);
  if (Number($("i-rpm").value) !== now.rpm) out.push(["rpm", $("i-rpm").value.trim(), true]);
  if (Number($("i-axis").value) !== now.axis) out.push(["axis", $("i-axis").value, true]);
  if ($("i-key").value.trim()) out.push(["passkey", $("i-key").value.trim(), false]);
  return out;
}
let armedWrite = 0;
$("i-write").onclick = async () => {
  if (!link || !now) return;
  const out = wanted(), say = t => { $("i-note").textContent = t; };
  if (!out.length) { say("Nothing has changed."); return; }
  const relearn = out.some(c => c[2]);
  // changing what the readings mean throws away the learned normal, so it takes a second press
  if (relearn && now.learned > 0 && Date.now() - armedWrite > 8000) {
    armedWrite = Date.now();
    say(`This starts a new day of learning and drops the ${now.learned} snapshots learned so far. Press again to write.`);
    return;
  }
  armedWrite = 0;
  try {
    for (const [k, v] of out) await link.set(k, v);
    $("i-key").value = "";
    formFilled = false;
    await refresh();
    say(`Written: ${out.map(c => c[0] === "brg" ? "bearing" : c[0]).join(", ")}.${relearn ? " The node is learning a new normal." : ""}${out.some(c => c[0] === "passkey") ? " The new passkey applies from the node's next wake." : ""}`);
  } catch (e) {
    formFilled = false;
    await refresh().catch(() => {});
    say(`Not written: ${e.message}.`);
  }
};
twice($("i-relearn"), "Press again to relearn", async () => {
  if (!link) return;
  try { await link.relearn(); await refresh(); $("i-note").textContent = "The node is learning a new normal."; }
  catch (e) { $("i-note").textContent = `Not done: ${e.message}.`; }
});

/* ---------- the round ---------- */
const STORE = "vigil-round";
let round = [];
try { round = JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { round = []; }
function logRound(s) {
  if (!via || s.error) return;
  const row = { t: Date.now(), visit, id: s.id, via: VIA[via], snap: s.snap, phase: s.phase, learned: `${s.learned}/${s.base}`, hi: s.hi, part: s.part, alarm: s.alarm,
                outer: s.outer, inner: s.inner, ball: s.ball, rms_g: s.rms_g };
  // one line for each visit to a node: while the handset stays connected the line follows the node
  const at = round.findIndex(r => r.id === row.id && r.via === row.via && r.visit === row.visit);
  if (at >= 0) round.splice(at, 1);
  round.unshift(row);
  round.length = Math.min(round.length, 300);
  try { localStorage.setItem(STORE, JSON.stringify(round)); } catch { /* private browsing: the round lasts as long as the page */ }
  drawRound();
}
function drawRound() {
  const body = $("round").tBodies[0];
  body.innerHTML = "";
  $("round-empty").hidden = round.length > 0;
  $("round").parentNode.hidden = !round.length;
  for (const r of round.slice(0, 40)) {
    const tr = h("tr"), when = new Date(r.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    tr.append(h("td", null, when), h("td", null, r.via === "demo" || r.via === "bench" ? `${r.id}, demo` : r.id),
      h("td", r.phase === "warning" ? "lead" : null, r.phase === "learning" ? `Learning ${r.learned}` : cap(r.phase)),
      h("td", null, r.hi != null && r.hi >= 0 ? r.hi.toFixed(2) : ""), h("td", null, r.part === "none" ? "" : cap(r.part)));
    body.appendChild(tr);
  }
}
$("r-csv").onclick = () => {
  if (!round.length) return;
  const head = "read_at,node,link,snapshot,state,learned,health_index,part,alarm,outer_db,inner_db,rolling_element_db,level_g";
  const rows = round.map(r => [new Date(r.t).toISOString(), r.id, r.via, r.snap, r.phase, r.learned, r.hi != null && r.hi >= 0 ? r.hi : "", r.part, r.alarm ? 1 : 0, r.outer, r.inner, r.ball, r.rms_g].join(","));
  save("vigil-round.csv", "text/csv", [[head, ...rows].join("\n") + "\n"]);
};
twice($("r-clear"), "Press again to forget", async () => {
  round = [];
  try { localStorage.removeItem(STORE); } catch { /* nothing stored */ }
  drawRound();
});

/* ---------- start ---------- */
$("c-bench").onclick = () => { simple = false; connect("bench"); };
$("c-ble").onclick = () => { simple = false; connect("ble"); };
$("c-usb").onclick = () => { simple = false; connect("usb"); };
$("c-off").onclick = () => disconnect();
drawRound();
let rt = 0;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (lastTrend && link) drawTrend(lastTrend); if (lastSes && !$("ev").hidden) drawSES(lastSes); }, 150); });
// what the menus need to know: whether a node is on the line, and what it calls itself
window.VigilHandset = { connected: () => !!(link && via && now), name: () => (now ? now.id : "") };
// say at once what this browser cannot do, in the row itself, before anyone taps it
if (!navigator.bluetooth) { $("c-ble").classList.add("off"); $("c-ble").querySelector(".d").textContent = "This browser cannot use Bluetooth. Chrome or Edge on Android or a computer can. An iPhone's own browser does not allow it."; }
if (!navigator.serial) { $("c-usb").classList.add("off"); $("c-usb").querySelector(".d").textContent = "This browser cannot open a serial port. Chrome or Edge on a computer can."; }
})();

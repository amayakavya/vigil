/* VIGIL's diagnosis tool: the method (vigil.js, run in worker.js) on a
   reference recording or a file the visitor gives it. Self-contained, so it
   sits on the live page beside the console without sharing any names. */
(() => {
"use strict";
const PART = { BPFO: "outer race", BPFI: "inner race", BSF: "rolling element" };
const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
const W80 = "rgba(242,243,245,0.95)", W30 = "rgba(255,255,255,0.3)", W15 = "rgba(255,255,255,0.12)";

/* ---------- the diagnosis tool ---------- */
let META = null, worker = null, pending = false, LAST_SES = null;
function workerRun(x, fs, rpm, orders) {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker("worker.js");
    worker.onmessage = e => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)));
    worker.onerror = e => reject(new Error(e.message || "The analysis could not start."));
    worker.postMessage({ x, fs, rpm, orders }, [x.buffer]);
  });
}
function geometryOrders(n, d, p, a) {
  const r = d / p * Math.cos(a * Math.PI / 180);
  return { BPFO: n / 2 * (1 - r), BPFI: n / 2 * (1 + r), BSF: p / (2 * d) * (1 - r * r), FTF: 0.5 * (1 - r) };
}
function setTab(rec) {
  $("t-rec").setAttribute("aria-selected", rec); $("t-file").setAttribute("aria-selected", !rec);
  $("p-rec").hidden = !rec; $("p-file").hidden = rec;
}
$("t-rec").onclick = () => setTab(true);
$("t-file").onclick = () => setTab(false);
$("brg").onchange = () => document.querySelectorAll("[data-custom]").forEach(f => f.hidden = $("brg").value !== "custom");

function parseText(t) {
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const cell = line.split(/[,;\t ]+/).find(c => c.length);
    if (cell === undefined) continue;
    const v = Number(cell);
    if (Number.isFinite(v)) out.push(v);
  }
  return Float64Array.from(out);
}
function parseWav(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("This is not a WAV file.");
  let o = 12, fmt = null;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { code: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === "data" && fmt) {
      const n = Math.floor(size / (fmt.bits / 8) / fmt.ch), x = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = o + 8 + i * fmt.ch * (fmt.bits / 8);
        if (fmt.code === 1 && fmt.bits === 16) x[i] = v.getInt16(p, true);
        else if (fmt.code === 3 && fmt.bits === 32) x[i] = v.getFloat32(p, true);
        else throw new Error("Only 16-bit PCM and 32-bit float WAV files are read.");
      }
      return { x, rate: fmt.rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("No audio data found in this WAV file.");
}

async function run() {
  if (pending) return;
  // lock the button and dim the last result at once: on a slow connection the
  // recording takes a moment to arrive, and the old answer must not pass for the new one
  pending = true;
  const btn = $("run");
  btn.disabled = true; btn.textContent = "Working"; $("out").classList.add("stale");
  let x, fs, rpm, orders, truth = null, note = "";
  try {
    if (!$("p-rec").hidden) {
      if (!META) throw new Error("The reference data has not loaded yet. Reload the page.");
      const s = META.samples.find(s => s.id === $("sample").value);
      const res = await fetch(`data/samples/${s.id}.i16`).catch(() => null);
      if (!res || !res.ok) throw new Error("That recording did not load. Check the connection and try again.");
      const buf = await res.arrayBuffer();
      if (buf.byteLength !== 2 * s.n) throw new Error("That recording arrived incomplete. Try again.");
      const q = new Int16Array(buf);
      x = Float64Array.from(q, v => v * s.scale); fs = s.fs; rpm = s.rpm; orders = META.bearings[s.bearing].orders; truth = s.truth;
      note = `${s.source}. ${(s.n / s.fs).toFixed(1)} s at ${s.fs.toLocaleString("en-IN")} Hz, shaft ${s.rpm.toFixed(0)} rpm. The Python reference said: ${s.expect.verdict ? PART[s.expect.verdict] : "declined"}.`;
    } else {
      const f = $("file").files[0];
      if (!f) throw new Error("Choose a file first.");
      fs = Number($("fs").value); rpm = Number($("rpm").value);
      if (/\.wav$/i.test(f.name)) { const w = parseWav(await f.arrayBuffer()); x = w.x; fs = w.rate; $("fs").value = fs; }
      else x = parseText(await f.text());
      if (!x.length) throw new Error("No numbers were found in that file.");
      if (!(fs >= 2000)) throw new Error("The sample rate must be at least 2,000 Hz to see a bearing's impacts.");
      if (!(rpm > 0)) throw new Error("Enter the shaft speed.");
      if (x.length < fs) throw new Error(`That is ${(x.length / fs).toFixed(2)} s of data. At least one second is needed.`);
      const cap = 1 << 18;
      if (x.length > cap) { x = x.slice(0, cap); note = `Only the first ${(cap / fs).toFixed(1)} s were used. `; }
      const b = $("brg").value;
      if (!META && b !== "custom") throw new Error("The reference data has not loaded yet. Reload the page.");
      orders = b === "custom" ? geometryOrders(+$("g-n").value, +$("g-d").value, +$("g-p").value, +$("g-a").value) : META.bearings[b].orders;
      note += `${f.name}, ${(x.length / fs).toFixed(1)} s at ${fs.toLocaleString("en-IN")} Hz, shaft ${rpm} rpm.`;
    }
    show({ r: await workerRun(x, fs, rpm, orders), truth, note });
  } catch (e) { show({ error: e.message }); }
  finally { pending = false; btn.disabled = false; btn.textContent = "Diagnose"; $("out").classList.remove("stale"); }
}
function show({ r, truth, note, error }) {
  $("out").hidden = false;
  $("out").dataset.runs = String(+($("out").dataset.runs || 0) + 1);
  if (error) {
    $("o-verdict").innerHTML = ""; $("o-verdict").textContent = error; $("o-verdict").className = "err";
    ["BPFO", "BPFI", "BSF", "band", "truth"].forEach(k => $("o-" + k).textContent = ""); $("ses").innerHTML = ""; $("ses-cap").textContent = "";
    return;
  }
  $("o-verdict").className = "";
  $("o-verdict").textContent = r.verdict ? `${PART[r.verdict][0].toUpperCase() + PART[r.verdict].slice(1)} defect` : "Declined, inspect";
  for (const k of ["BPFO", "BPFI", "BSF"]) $("o-" + k).textContent = `${r.scores[k].toFixed(1)} dB at ${(k === "BSF" ? 2 * r.lines[k] : r.lines[k]).toFixed(1)} Hz`;
  $("o-band").textContent = `${Math.round(r.band[0]).toLocaleString("en-IN")} to ${Math.round(r.band[1]).toLocaleString("en-IN")} Hz`;
  $("o-truth-row").hidden = !truth;
  $("o-truth").textContent = truth ? PART[truth] : "";
  drawSES(r);
  $("ses-cap").textContent = `Squared envelope spectrum of the chosen band. Dashed lines are where each defect would show, from the bearing's geometry. The rolling element is drawn at twice its spin rate, because it strikes both races. A part is named when its line stands at least 10 dB above its neighbourhood. ${note}`;
}
function drawSES(r) {
  const svg = $("ses"); svg.innerHTML = ""; LAST_SES = r;
  const W = Math.max(320, Math.round(svg.parentNode.clientWidth || 820)), H = W < 600 ? 230 : 250, m = { l: 8, r: 8, t: 40, b: 28 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const x = f => m.l + (W - m.l - m.r) * f / r.top, y = v => m.t + (H - m.t - m.b) * (1 - Math.min(v, 1.1) / 1.1);
  const marks = [[r.lines.BPFO, "outer"], [r.lines.BPFI, "inner"], [2 * r.lines.BSF, "rolling element"]].sort((a, b) => a[0] - b[0]);
  marks.forEach(([f, lab], i) => {
    for (let h = 1; h * f < r.top; h++) el("line", { x1: x(h * f), x2: x(h * f), y1: m.t - 4 + (h > 1 ? 10 : 0), y2: H - m.b, stroke: h > 1 ? W15 : W30, "stroke-dasharray": "3 4" }, svg);
    const right = x(f) > W * 0.62;
    el("text", { x: x(f) + (right ? -4 : 4), y: 12 + i * 12, "text-anchor": right ? "end" : "start" }, svg).textContent = `${lab} ${f.toFixed(1)} Hz`;
  });
  let p = "";
  r.f.forEach((f, i) => { p += (i ? "L" : "M") + x(f).toFixed(1) + " " + y(r.s[i]).toFixed(1); });
  el("path", { d: p, fill: "none", stroke: W80, "stroke-width": 1 }, svg);
  el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: W15 }, svg);
  let step = r.top > 1500 ? 500 : r.top > 600 ? 200 : 100;
  if (W < 600) step *= 2;
  for (let f = step; f < r.top; f += step) el("text", { x: x(f), y: H - 8, "text-anchor": "middle" }, svg).textContent = f.toLocaleString("en-IN");
  el("text", { x: W - m.r, y: H - 8, "text-anchor": "end" }, svg).textContent = "Hz";
}
$("run").onclick = run;

fetch("data/samples.json").then(r => r.json()).then(meta => {
  META = meta;
  const sel = $("sample");
  for (const s of meta.samples) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.label; sel.appendChild(o); }
  const note = () => { const s = meta.samples.find(s => s.id === sel.value); $("sample-note").textContent = s.source + "."; };
  sel.onchange = () => { note(); $("out").hidden = true; };
  note();
}).catch(() => { $("sample-note").textContent = "The reference recordings did not load. Reload the page."; });
$("file").onchange = () => { $("out").hidden = true; };
let rt = 0;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (LAST_SES) drawSES(LAST_SES); }, 150); });
})();

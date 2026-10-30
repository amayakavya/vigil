// Runs the page's JavaScript (docs/vigil.js) on every reference recording and
// checks it against what analysis/vigil.py said about the same samples.
// Pass: same verdict, same band, every line score within 0.01 dB.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const V = require("../docs/vigil.js");
const dir = new URL("../docs/data/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("samples.json", dir)));
let fail = 0, worst = 0;
for (const s of meta.samples) {
  const buf = readFileSync(new URL(`samples/${s.id}.i16`, dir));
  const q = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const x = Float64Array.from(q, v => v * s.scale);
  const t = performance.now();
  const d = V.diagnose(x, s.fs, s.rpm / 60, meta.bearings[s.bearing].orders);
  const ms = performance.now() - t;
  const diffs = Object.keys(d.scores).map(k => Math.abs(d.scores[k] - s.expect.scores[k]));
  const dmax = Math.max(...diffs); worst = Math.max(worst, dmax);
  const ok = d.verdict === s.expect.verdict && Math.abs(d.band[0] - s.expect.band[0]) < 1e-6 && Math.abs(d.band[1] - s.expect.band[1]) < 1e-6 && dmax < 0.01;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${s.id.padEnd(14)} verdict ${String(d.verdict).padEnd(5)} (py ${String(s.expect.verdict).padEnd(5)}) band ${d.band.join("-")} (py ${s.expect.band.join("-")}) max line diff ${dmax.toExponential(2)} dB, ${ms.toFixed(0)} ms`);
}
console.log(`${meta.samples.length - fail} of ${meta.samples.length} match the Python reference; worst line-score difference ${worst.toExponential(2)} dB`);
process.exit(fail ? 1 : 0);

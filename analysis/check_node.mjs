// The node's application (firmware/core/node.c, built to docs/node.wasm) and
// the handset's side of the link (docs/link.js), run against each other.
//
//   node analysis/check_node.mjs           the link, on the bench recordings the page ships
//   node analysis/check_node.mjs --nasa    and all twelve NASA bearings through the node's own
//                                          learning, alarm and trend (needs ~/vigil-data, about 15 minutes)
//   node analysis/check_node.mjs --bench   rebuild docs/data/bench from ~/vigil-data
//
// Pass, on the bench: the handset reads back exactly what the node holds (status,
// 48 hours of trend, every sample of every recording, CRC checked), the phone's
// own analysis of those samples agrees with the node's, a spot reading leaves the
// node's memory untouched, bad settings are refused, and a warning survives a
// power cut. Pass, on NASA: every alarm and every name falls on the analysis's snapshot.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";
import os from "node:os";
const require = createRequire(import.meta.url);
const B = require("../docs/benchnode.js"), { Link } = require("../docs/link.js"), V = require("../docs/vigil.js");
const DOCS = new URL("../docs/", import.meta.url), BENCH = new URL("data/bench/", DOCS);
const IMS = os.homedir() + "/vigil-data/ims/4. Bearings/";
const RUNS = { 1: ["1st_test/", [0, 2, 4, 6]], 2: ["2nd_test/", [0, 1, 2, 3]], 3: ["4th_test/txt/", [0, 1, 2, 3]] };
const PART = [null, "BPFO", "BPFI", "BSF"], NAME = { BPFO: "outer race", BPFI: "inner race", BSF: "rolling element" };
const N = 20480, FS = 20480, SCALE = 0.001, FIRST = 570, COUNT = 12;
const wasm = readFileSync(new URL("node.wasm", DOCS));
const ims = JSON.parse(readFileSync(new URL("data/ims.json", DOCS)));

// one column of one NASA snapshot, as the numbers in the file
function column(path, col, x) {
  const txt = readFileSync(path, "latin1");
  for (let k = 0, p = 0; k < N; k++) {
    const e = txt.indexOf("\n", p);
    x[k] = Number(txt.slice(p, e < 0 ? undefined : e).split("\t")[col]);
    p = e + 1;
  }
}

// one NASA bearing through the node, start to finish
async function replay(run, bearing, stopAfter) {
  const [dir, cols] = RUNS[run], names = readdirSync(IMS + dir).sort(), want = ims[run].bearings[bearing];
  const node = await B.create(wasm, () => {});
  node.boot(N);
  node.setBase(ims[run].n_base);
  const x = new Float32Array(N), last = stopAfter ?? names.length - 1;
  let alarm = -1, named = -1, namedAs = null, worst = 0, image = null;
  for (let i = 0; i <= last; i++) {
    column(IMS + dir + names[i], cols[bearing - 1], x);
    const a0 = node.alarm(), n0 = node.named();
    node.scheduled(x, FS, SCALE, 600 * i);
    if (!a0 && node.alarm()) alarm = i - 2;                       // the first of the three readings
    if (n0 < 0 && node.named() >= 0) { named = i - 2; namedAs = PART[node.named() + 1]; }
    // the analysis publishes its health index capped at 99
    if (i >= ims[run].n_base && node.hi() >= 0 && want.hi[i] != null) worst = Math.max(worst, Math.abs(Math.min(node.hi(), 99) - want.hi[i]));
  }
  if (stopAfter != null) image = node.image();
  const ok = alarm === (want.alarm_idx ?? -1) && named === (want.named_idx ?? -1) && namedAs === (want.named_as ?? null) && worst < 0.011;
  return { run, bearing, snapshots: last + 1, ok, alarm, named, namedAs, worst, image, names };
}

if (!isMainThread) {
  replay(workerData.run, workerData.bearing).then(r => parentPort.postMessage({ ...r, image: null, names: null }));
} else {
  let bad = 0;
  const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };

  /* ---- rebuild the bench from NASA's files ---- */
  if (process.argv.includes("--bench")) {
    const r = await replay(2, 1, FIRST - 1);
    const [dir, cols] = RUNS[2], x = new Float32Array(N), q = new Int16Array(N * COUNT), files = r.names.slice(FIRST, FIRST + COUNT);
    files.forEach((name, i) => {
      column(IMS + dir + name, cols[0], x);
      for (let k = 0; k < N; k++) {
        const c = Math.round(x[k] * 1000);
        if (Math.abs(c) > 32767 || Math.fround(c / 1000) !== x[k]) throw new Error(`${name}: sample ${k} is not a whole count of 0.001 g`);
        q[i * N + k] = c;
      }
    });
    mkdirSync(BENCH, { recursive: true });
    writeFileSync(new URL("node.img", BENCH), r.image);
    writeFileSync(new URL("ims2-b1.i16", BENCH), new Uint8Array(q.buffer));
    writeFileSync(new URL("bench.json", BENCH), JSON.stringify({
      source: "NASA IMS test 2, bearing 1", bearing: "Rexnord ZA-2115", fs: FS, n: N, scale: SCALE, rpm: 2000, first: FIRST,
      start: ims[2].start, files, image: "node.img", recordings: "ims2-b1.i16",
      analysis_hi: ims[2].bearings[1].hi.slice(FIRST - 288, FIRST + COUNT), named_at: ims[2].bearings[1].named_idx + 2, named_as: ims[2].bearings[1].named_as,
    }, null, 1) + "\n");
    console.log(`bench rebuilt: the node's memory after snapshot ${FIRST - 1}, and recordings ${FIRST} to ${FIRST + COUNT - 1}`);
  }

  /* ---- the link, on what the page ships ---- */
  const meta = JSON.parse(readFileSync(new URL("bench.json", BENCH)));
  const img = new Uint8Array(readFileSync(new URL(meta.image, BENCH)));
  const rec = readFileSync(new URL(meta.recordings, BENCH));
  const counts = new Int16Array(rec.buffer, rec.byteOffset, rec.length / 2);
  const orders = JSON.parse(readFileSync(new URL("data/samples.json", DOCS))).bearings["ZA-2115"].orders;
  const snapshot = i => Float32Array.from(counts.subarray(i * meta.n, (i + 1) * meta.n), c => Math.fround(c / 1000));

  let now = 600 * (meta.first - 1), link = null;
  const node = await B.create(wasm, l => link.feed(l + "\n"));
  // the handset's own Link, on a wire that is the firmware's command handler
  link = new Link(cmd => { if (node.command(cmd, now) & B.WANT_SPOT) node.spot(snapshot(step), meta.fs, meta.scale); });
  let step = 0;
  node.boot(meta.n);
  node.load(img);

  let st = await link.status();
  check(st.phase === "normal" && st.snap === meta.first && st.learned === 144 && st.part === "none" && !st.alarm,
        `status after loading the node's memory: ${st.phase}, snapshot ${st.snap}, learned ${st.learned}/${st.base}`);
  const tr = await link.trend();
  const trWorst = Math.max(...tr.hi.map((v, i) => v == null ? 0 : Math.abs(v - meta.analysis_hi[i])));
  check(tr.hi.length === 288 && tr.period === 600 && trWorst < 0.011, `trend: ${tr.hi.length} readings over 48 h, CRC good, worst difference from the analysis ${trWorst.toFixed(4)}`);

  let rawWorst = 0, bandSame = true, namedStep = -1, hiWorst = 0, exact = true, heard = 0;
  link.onstatus = () => heard++;
  for (step = 0; step < COUNT; step++) {
    now += 600;
    node.scheduled(snapshot(step), meta.fs, meta.scale, now);
    if (namedStep < 0 && node.named() >= 0) namedStep = step;
    hiWorst = Math.max(hiWorst, Math.abs(node.hi() - meta.analysis_hi[288 + step]));
    const raw = await link.raw();
    for (let k = 0; k < meta.n; k++) if (raw.q[k] !== counts[step * meta.n + k]) { exact = false; break; }
    // what the handset does with it: the page's method, on the node's samples
    const d = V.diagnose(Float64Array.from(raw.q, v => v * raw.scale), raw.fs, raw.rpm / 60, orders);
    for (const k of ["BPFO", "BPFI", "BSF"]) rawWorst = Math.max(rawWorst, Math.abs(d.scores[k] - raw.scores[k]));
    bandSame = bandSame && d.band[0] === raw.band[0] && d.band[1] === raw.band[1];
  }
  st = await link.status();
  check(heard === COUNT + 1, `the node spoke on every wake: ${heard - 1} status lines for ${COUNT} snapshots`);
  check(namedStep === meta.named_at - meta.first && st.part === NAME[meta.named_as] && st.phase === "warning",
        `warning on the analysis's snapshot: named ${st.part} at recording ${meta.first + namedStep} (analysis ${meta.named_at})`);
  const why = await link.why();
  check(why && why.snap === meta.named_at + 1 && why.outer >= 10 && why.ago === 600 * (COUNT - 1 - namedStep),
        `the node keeps the reading it raised the warning on: snapshot ${why && why.snap}, outer race line ${why && why.outer} dB`);
  check(hiWorst < 0.011, `health index on the ${COUNT} recordings within ${hiWorst.toFixed(4)} of the analysis`);
  check(exact, `raw recordings: ${COUNT} of ${COUNT} arrive sample for sample, CRC good`);
  check(bandSame && rawWorst < 0.01, `the phone's analysis of the node's samples: same band, line strengths within ${rawWorst.toFixed(5)} dB of the node's`);

  step = COUNT - 1;
  // a spot reading of the samples just scored must give that score, and change nothing
  const before = node.image(), scored = node.hi(), sp = await link.spot(), after = node.image();
  check(sp.read === "ok" && Math.abs(sp.hi - scored) < 0.006 && before.every((b, i) => b === after[i]),
        `spot reading: health index ${sp.hi} against ${scored.toFixed(2)} scheduled, and the node's memory is byte for byte as it was`);

  const refused = async cmd => { try { await link.command(cmd); return false; } catch { return true; } };
  check(await refused("SET rpm=10") && await refused("SET passkey=12") && await refused("SET id=a|b") && await refused("SET brg=9/40/39/0") && await refused("FORMAT"),
        "bad settings and unknown commands are refused");
  await link.set("id", "GEN-07"); await link.set("passkey", "135790");
  st = await link.status();
  check(st.id === "GEN-07" && st.phase === "warning", "a new id and passkey do not disturb the warning");
  node.powerCut();
  st = await link.status();
  const cut = await link.trend();
  check(st.phase === "warning" && st.part === "outer race" && st.learned === 144 && cut.hi.length === 0 && await link.why() === null,
        "after a power cut the warning and the learned normal are read back, and the trend starts again");
  await link.clear();
  st = await link.status();
  check(st.phase === "normal" && st.part === "none" && await link.why() === null, "CLEAR after the repair takes the warning down");
  await link.set("brg", "9/7.94/39.04/0");
  st = await link.status();
  check(st.phase === "learning" && st.learned === 0 && st.brg.join() === "9,7.94,39.04,0" && await refused("CLEAR"), "a new bearing starts a new normal");

  const fresh = await B.create(wasm, () => {});
  fresh.boot(meta.n);
  const due0 = fresh.due(0);
  fresh.scheduled(snapshot(0), meta.fs, meta.scale, 3);
  const grid = fresh.sleep(3) === 597 && !fresh.due(599) && fresh.due(600);
  fresh.scheduled(snapshot(0), meta.fs, meta.scale, 601);
  const kept = fresh.sleep(601) === 599;
  fresh.scheduled(snapshot(0), meta.fs, meta.scale, 5000);
  check(due0 && grid && kept && fresh.sleep(5000) === 600, "the ten-minute clock: due at power-on, holds its grid, restarts it after a gap");

  /* ---- NASA, whole ---- */
  if (process.argv.includes("--nasa")) {
    if (!existsSync(IMS)) { console.log(`FAIL no NASA data at ${IMS}`); process.exit(1); }
    const again = await replay(2, 1, FIRST - 1);
    check(again.image.length === img.length && again.image.every((b, i) => b === img[i]), "the shipped node memory is what the firmware holds after NASA's own files");
    const jobs = [];
    for (const run of [1, 2, 3]) for (const bearing of [1, 2, 3, 4]) jobs.push({ run, bearing });
    const rows = [];
    const pool = Math.max(1, Math.min(8, os.availableParallelism() - 1));
    await Promise.all(Array.from({ length: pool }, async () => {
      for (let job; (job = jobs.shift());) {
        const r = await new Promise((res, rej) => { const w = new Worker(new URL(import.meta.url), { workerData: job }); w.once("message", res); w.once("error", rej); });
        rows.push(r);
      }
    }));
    rows.sort((a, b) => a.run - b.run || a.bearing - b.bearing);
    for (const r of rows) check(r.ok, `run ${r.run} bearing ${r.bearing}: ${r.snapshots} snapshots, alarm at ${r.alarm}, named at ${r.named}${r.namedAs ? " as " + r.namedAs : ""}, health index within ${r.worst.toFixed(4)} of the analysis`);
    const total = rows.reduce((s, r) => s + r.snapshots, 0), passed = rows.filter(r => r.ok).length;
    console.log(`${passed} of ${rows.length} bearings, ${total.toLocaleString("en-US")} snapshots: the node application makes the analysis's decisions on the same snapshots`);
    writeFileSync(new URL("../firmware/test/node_result.json", import.meta.url), JSON.stringify({
      bearings: rows.length, passed, snapshots: total, worst_health_index_difference: +Math.max(...rows.map(r => r.worst)).toFixed(4),
      rows: rows.map(r => ({ run: r.run, bearing: r.bearing, snapshots: r.snapshots, pass: r.ok, alarm_idx: r.alarm, named_idx: r.named, named_as: r.namedAs })),
    }, null, 1) + "\n");
  }
  console.log(bad ? `${bad} problem(s)` : "the node and the handset agree");
  process.exit(bad ? 1 : 0);
}

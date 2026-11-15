/* The bench node, off the page's main thread: the node's firmware
   (node.wasm) started from the memory it held on NASA test 2, bearing 1 after
   its snapshot of 16 Feb 2004 09:22, then given the next recordings one at a
   time. It speaks the node's own lines, so the handset drives it exactly as
   it drives a board. analysis/check_node.mjs runs this same sequence. */
importScripts("benchnode.js");
let node = null, meta = null, counts = null, image = null, step = -1, now = 0;
const get = (url, as) => fetch(url).then(r => { if (!r.ok) throw new Error("The bench files did not load. Check the connection and try again."); return r[as](); });
// the recordings are whole counts of 0.001 g, which is how NASA's files print them
const snapshot = i => Float32Array.from(counts.subarray(i * meta.n, (i + 1) * meta.n), c => Math.fround(c / 1000));
function start() { node.load(image); step = -1; now = 600 * (meta.first - 1); }
const ready = (async () => {
  const wasm = await get("node.wasm", "arrayBuffer");
  meta = await get("data/bench/bench.json", "json");
  image = new Uint8Array(await get("data/bench/" + meta.image, "arrayBuffer"));
  counts = new Int16Array(await get("data/bench/" + meta.recordings, "arrayBuffer"));
  node = await VigilBench.create(wasm, line => postMessage({ line }));
  node.boot(meta.n);
  start();
  postMessage({ ready: true, total: meta.files.length, files: meta.files, source: meta.source });
})();
ready.catch(e => postMessage({ error: String(e && e.message || e) }));

onmessage = async e => {
  try { await ready; } catch { return; }
  const m = e.data;
  if (m.line !== undefined) {
    // a spot reading on the bench reads the recording the node is on
    if (node.command(m.line, now) & VigilBench.WANT_SPOT) node.spot(snapshot(Math.max(step, 0)), meta.fs, meta.scale);
  } else if (m.advance) {
    if (step + 1 >= meta.files.length) { postMessage({ step, end: true }); return; }
    step++; now += 600;
    node.scheduled(snapshot(step), meta.fs, meta.scale, now);     // the status line goes out as on any wake
    postMessage({ step, end: step + 1 >= meta.files.length });
  } else if (m.reset) {
    start();
    postMessage({ step, end: false, reset: true });
  }
};

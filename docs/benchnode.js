/* The board under the bench node: loads node.wasm (the node's own C, built by
   firmware/wasm/build.sh) and gives it what a board would, which is samples, a
   clock, and somewhere for its lines to go. Used by the handset's worker
   (bench.js) and by analysis/check_node.mjs, so the page and the check drive
   the firmware through the same few calls. */
(function (root) {
  "use strict";
  async function create(wasm, onLine) {
    const dec = new TextDecoder(), enc = new TextEncoder();
    let mem = null;
    const { instance } = await WebAssembly.instantiate(wasm, {
      env: { emit: (p, len) => onLine(dec.decode(new Uint8Array(mem.buffer, p, len).slice())) },
    });
    const e = instance.exports;
    mem = e.memory;
    e._initialize();
    // views are taken fresh each time: the memory moves when the module grows it
    const bytes = (p, n) => new Uint8Array(mem.buffer, p, n);
    const node = {
      n: 0,
      boot(n) { if (e.vn_boot(n)) throw new Error("The bench node could not start."); node.n = n; },
      /* x: one snapshot in g, Float32Array of the booted length */
      put(x) { new Float32Array(mem.buffer, e.vn_samples(), node.n).set(x); },
      scheduled(x, fs, scale, now) { node.put(x); return e.vn_scheduled(fs, scale, now); },
      spot(x, fs, scale) { node.put(x); e.vn_spot(fs, scale); },
      command(line, now) {
        const b = enc.encode(line);
        if (b.length > 250) { onLine("ERR ? line too long"); return 0; }
        const buf = bytes(e.vn_line(), 256);
        buf.fill(0); buf.set(b);
        return e.vn_command(now);
      },
      /* what survives deep sleep, then the installation: the two things a board keeps */
      image() {
        const a = bytes(e.vn_image(), e.vn_image_bytes()), b = bytes(e.vn_config(), e.vn_config_bytes());
        const out = new Uint8Array(a.length + b.length);
        out.set(a); out.set(b, a.length);
        return out;
      },
      load(img) {
        const na = e.vn_image_bytes(), nb = e.vn_config_bytes();
        if (img.length !== na + nb) throw new Error("That image is for a different build of the firmware.");
        bytes(e.vn_image(), na).set(img.subarray(0, na));
        bytes(e.vn_config(), nb).set(img.subarray(na));
      },
      setBase(n) { e.vn_set_base(n); },
      powerCut() { e.vn_power_cut(); },
      due: now => e.vn_due(now) === 1, sleep: now => e.vn_sleep_s(now),
      alarm: () => e.vn_alarm() === 1, named: () => e.vn_named(), hi: () => e.vn_hi(), feature: j => e.vn_feature(j),
    };
    return node;
  }
  const api = { create, WANT_SPOT: 4 };
  root.VigilBench = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);

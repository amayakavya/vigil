/* The handset's side of the node's conversation: lines out, lines back, the
   same over Bluetooth, the USB cable and the bench node. firmware/core/node.c
   is the other side, and analysis/check_node.mjs runs the two against each
   other on NASA's recordings, so neither is trusted on its own. */
(function (root) {
  "use strict";

  const TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE[i] = c >>> 0; }
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function unb64(s) { const t = atob(s), out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; }
  function fields(line) {
    const kv = {};
    for (const part of line.split("|").slice(1)) { const i = part.indexOf("="); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
    return kv;
  }
  // the status line, with its numbers as numbers
  function status(line) {
    const kv = fields(line), num = k => (kv[k] === undefined || kv[k] === "" ? null : Number(kv[k]));
    const [done, of] = (kv.learned || "0/0").split("/").map(Number);
    return {
      id: kv.id || "", fw: num("fw") || 1, phase: kv.phase || "unknown", learned: done, base: of, snap: num("snap"), age: num("age"),
      read: kv.read || (kv.error ? "none" : "ok"), hi: num("hi"), part: kv.part || "none", alarm: num("alarm") === 1,
      outer: num("outer"), inner: num("inner"), ball: num("ball"), rms_g: num("rms_g"), fs: num("fs"), rpm: num("rpm"),
      brg: kv.brg ? kv.brg.split("/").map(Number) : null, axis: num("axis"), error: kv.error || null, line,
    };
  }

  // the words of a T or R block, in order, with the node's CRC checked
  function words(lines, tag, endTag) {
    const chunks = [];
    let total = 0, seq = 0, crc = null;
    for (const l of lines) {
      if (l.startsWith(tag + "|")) {
        const a = l.indexOf("|"), b = l.indexOf("|", a + 1);
        if (Number(l.slice(a + 1, b)) !== seq++) throw new Error("A line went missing on the way. Try again nearer the node.");
        const bytes = unb64(l.slice(b + 1));
        chunks.push(bytes); total += bytes.length;
      } else if (l.startsWith(endTag + "|")) crc = parseInt(fields(l).crc, 16);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    if (crc === null || crc32(all) !== crc) throw new Error("It did not arrive whole. Try again nearer the node.");
    return new DataView(all.buffer);
  }

  class Link {
    /* send(line) puts one line on the wire. Feed whatever arrives to feed(). */
    constructor(send) {
      this.send = send; this.buf = ""; this.cur = null; this.tail = Promise.resolve();
      this.onstatus = null;    // every status line, asked for or not: a node prints one each time it wakes
    }
    feed(text) {
      this.buf += text;
      for (let i; (i = this.buf.indexOf("\n")) >= 0;) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        if (line) this.line(line);
      }
    }
    line(l) {
      if (l.startsWith("VIGIL1|") && this.onstatus) this.onstatus(status(l));
      const c = this.cur;
      if (!c) return;
      if (l.startsWith("OK ") || l.startsWith("ERR ")) {
        clearTimeout(c.timer); this.cur = null;
        if (l[0] === "O") c.resolve(c.lines);
        else c.reject(new Error(l.replace(/^ERR \S+ ?/, "") || "The node refused."));
        return;
      }
      c.lines.push(l);
      if (c.progress) c.progress(c.lines.length, l);
      c.arm();
    }
    /* One command at a time. The reply is every line up to the node's OK. */
    command(cmd, { quiet = 8000, progress = null } = {}) {
      const run = () => new Promise((resolve, reject) => {
        const c = { lines: [], resolve, reject, progress, timer: 0 };
        c.arm = () => { clearTimeout(c.timer); c.timer = setTimeout(() => { if (this.cur === c) this.cur = null; reject(new Error("The node stopped answering.")); }, quiet); };
        this.cur = c; c.arm();
        Promise.resolve().then(() => this.send(cmd)).catch(e => { clearTimeout(c.timer); if (this.cur === c) this.cur = null; reject(e); });
      });
      const p = this.tail.then(run, run);
      this.tail = p.catch(() => {});
      return p;
    }
    async status() {
      const l = (await this.command("STATUS")).find(l => l.startsWith("VIGIL1|"));
      if (!l) throw new Error("The node sent no status.");
      return status(l);
    }
    /* The last 48 hours: one health index per ten-minute snapshot, oldest first.
       null where the machine was stopped, and learning marked apart. */
    async trend() {
      const lines = await this.command("TREND");
      const head = fields(lines.find(l => l.startsWith("TREND|")) || "");
      const v = words(lines, "T", "TEND"), n = v.byteLength / 2;
      if (n !== Number(head.n)) throw new Error("It did not arrive whole. Try again nearer the node.");
      const hi = [], learning = [];
      for (let i = 0; i < n; i++) {
        const w = v.getUint16(2 * i, true);
        learning.push(w === 0xFFFE);
        hi.push(w >= 0xFFFE ? null : w / 100);
      }
      return { period: Number(head.period), age: Number(head.age), hi, learning };
    }
    /* The samples of the node's latest reading, as the sensor's own integers,
       with what the node made of them. */
    async raw(progress) {
      let total = 0;      // known once the header line is in: how many lines the recording will take
      const lines = await this.command("RAW", { quiet: 15000, progress: (k, l) => {
        if (l.startsWith("RAW|")) total = Math.ceil(2 * Number(fields(l).n) / 168) + 2;
        if (progress && total) progress(Math.min(1, k / total));
      } });
      const head = fields(lines.find(l => l.startsWith("RAW|")) || ""), n = Number(head.n);
      const v = words(lines, "R", "REND");
      if (v.byteLength !== 2 * n) throw new Error("It did not arrive whole. Try again nearer the node.");
      const q = new Int16Array(n);
      for (let i = 0; i < n; i++) q[i] = v.getInt16(2 * i, true);
      return {
        q, n, fs: Number(head.fs), scale: Number(head.scale), snap: Number(head.snap), spot: head.spot === "1", rpm: Number(head.rpm),
        rms_g: Number(head.rms_g), scores: { BPFO: Number(head.outer), BPFI: Number(head.inner), BSF: Number(head.ball) },
        band: [Number(head.lo), Number(head.hi)],
      };
    }
    /* The reading a standing warning was raised on, or null when the node holds none. */
    async why() {
      let lines;
      try { lines = await this.command("WHY"); } catch (e) { if (/no reading held/.test(e.message)) return null; throw e; }
      const kv = fields(lines.find(l => l.startsWith("WHY|")) || "");
      return { snap: Number(kv.snap), ago: Number(kv.ago), hi: Number(kv.hi), outer: Number(kv.outer), inner: Number(kv.inner), ball: Number(kv.ball), rms_g: Number(kv.rms_g) };
    }
    async spot() {
      const l = (await this.command("SNAP", { quiet: 30000 })).find(l => l.startsWith("SPOT|"));
      const kv = fields(l || "");
      return { read: kv.read, hi: Number(kv.hi), points: kv.points, outer: Number(kv.outer), inner: Number(kv.inner), ball: Number(kv.ball),
               rms_g: Number(kv.rms_g), fs: Number(kv.fs) };
    }
    set(key, value) { return this.command(`SET ${key}=${value}`); }
    clear() { return this.command("CLEAR"); }
    relearn() { return this.command("RELEARN"); }
  }

  const api = { Link, status, fields, crc32 };
  root.VigilLink = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);

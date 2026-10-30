/* Runs the diagnosis off the page's main thread: a ten-second recording takes
   about a second of FFT work, which would otherwise freeze the controls. */
importScripts("vigil.js");
onmessage = e => {
  const { x, fs, rpm, orders } = e.data;
  try {
    const d = self.Vigil.diagnose(x, fs, rpm / 60, orders);
    // the spectrum is sent back max-pooled to ~900 points over the range worth drawing
    const top = Math.min(fs / 2, Math.max(4.6 * d.lines.BPFI, 2.2 * 2 * d.lines.BSF));
    const n = 900, f = [], s = [];
    let peak = 0;
    for (let k = 0; k < d.fr.length && d.fr[k] <= top; k++) if (d.fr[k] >= 0.3 * d.lines.BPFO) peak = Math.max(peak, d.S[k]);
    for (let b = 0; b < n; b++) {
      const lo = top * b / n, hi = top * (b + 1) / n;
      let m = 0;
      for (let k = Math.floor(lo / d.fr[1]); k < d.fr.length && d.fr[k] < hi; k++) if (d.fr[k] >= lo) m = Math.max(m, d.S[k]);
      f.push((lo + hi) / 2); s.push(peak ? Math.min(m / peak, 1.2) : 0);
    }
    postMessage({ ok: true, verdict: d.verdict, scores: d.scores, band: d.band, lines: d.lines, f, s, top });
  } catch (err) {
    postMessage({ ok: false, error: String(err && err.message || err) });
  }
};

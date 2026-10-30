/* VIGIL signal core, the same steps as analysis/vigil.py, for the browser and
   for Node (analysis/check_js.mjs runs it against the Python reference).

   Prewhiten the spectrum, find the most impulsive band within the sensor's
   bandwidth, take the squared envelope spectrum, and score the defect lines the
   bearing's geometry predicts. A part is named only when one line stands 10 dB
   clear of its neighbourhood. Any length of signal works: powers of two go
   straight to a radix-2 FFT, every other length through Bluestein's chirp-z. */
(function (root) {
  "use strict";

  const twiddles = new Map();
  function table(n) {
    let t = twiddles.get(n);
    if (!t) {
      t = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
      for (let k = 0; k < n / 2; k++) { t.c[k] = Math.cos(2 * Math.PI * k / n); t.s[k] = Math.sin(2 * Math.PI * k / n); }
      twiddles.set(n, t);
    }
    return t;
  }

  // in place; sign -1 forward, +1 inverse (unscaled)
  function radix2(re, im, sign) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const T = table(n);
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, stride = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = T.c[k * stride], wi = sign * T.s[k * stride];
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  const chirps = new Map();
  function chirp(n, m) {
    const key = n + ":" + m;
    let c = chirps.get(key);
    if (!c) {
      // exp(-i pi k^2 / n), with k^2 reduced mod 2n so the angle stays exact for long signals
      const wr = new Float64Array(n), wi = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const a = Math.PI * ((k * k) % (2 * n)) / n;
        wr[k] = Math.cos(a); wi[k] = -Math.sin(a);
      }
      const br = new Float64Array(m), bi = new Float64Array(m);
      br[0] = wr[0]; bi[0] = -wi[0];
      for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
      radix2(br, bi, -1);
      c = { wr, wi, br, bi };
      chirps.set(key, c);
    }
    return c;
  }

  function fft(re, im, sign) {
    const n = re.length;
    if ((n & (n - 1)) === 0) { radix2(re, im, sign); return; }
    let m = 1;
    while (m < 2 * n - 1) m <<= 1;
    const c = chirp(n, m);
    const ar = new Float64Array(m), ai = new Float64Array(m);
    for (let k = 0; k < n; k++) {
      const wi = sign < 0 ? c.wi[k] : -c.wi[k];
      ar[k] = re[k] * c.wr[k] - im[k] * wi;
      ai[k] = re[k] * wi + im[k] * c.wr[k];
    }
    radix2(ar, ai, -1);
    for (let k = 0; k < m; k++) {
      const bi = sign < 0 ? c.bi[k] : -c.bi[k];
      const xr = ar[k] * c.br[k] - ai[k] * bi, xi = ar[k] * bi + ai[k] * c.br[k];
      ar[k] = xr; ai[k] = xi;
    }
    radix2(ar, ai, 1);
    for (let k = 0; k < n; k++) {
      const wi = sign < 0 ? c.wi[k] : -c.wi[k];
      const xr = ar[k] / m, xi = ai[k] / m;
      re[k] = xr * c.wr[k] - xi * wi;
      im[k] = xr * wi + xi * c.wr[k];
    }
  }

  function rfft(x) {
    const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
    fft(re, im, -1);
    const h = (n >> 1) + 1;
    return { re: re.subarray(0, h), im: im.subarray(0, h), n };
  }

  // numpy.fft.irfft: the imaginary parts of DC and (for even n) Nyquist are ignored
  function irfft(Xr, Xi, n) {
    const re = new Float64Array(n), im = new Float64Array(n), h = (n >> 1) + 1;
    re[0] = Xr[0];
    for (let k = 1; k < h; k++) {
      re[k] = Xr[k]; im[k] = Xi[k];
      if (n - k !== k) { re[n - k] = Xr[k]; im[n - k] = -Xi[k]; }
    }
    if (n % 2 === 0) im[n >> 1] = 0;
    fft(re, im, 1);
    for (let k = 0; k < n; k++) re[k] /= n;
    return re;
  }

  const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  function median(a) {
    const s = Float64Array.from(a).sort(), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function prewhiten(x) {
    const mu = mean(x), X = rfft(Array.prototype.map.call(x, v => v - mu));
    const r = new Float64Array(X.re.length), i = new Float64Array(X.re.length);
    for (let k = 0; k < r.length; k++) {
      const a = Math.hypot(X.re[k], X.im[k]) + 1e-12;
      r[k] = X.re[k] / a; i[k] = X.im[k] / a;
    }
    return irfft(r, i, x.length);
  }

  // squared envelope of the band [lo, hi): a one-sided spectrum is the analytic signal
  // numpy.fft.rfftfreq computes k * (1 / (n * (1 / fs))); doing the same
  // arithmetic keeps a bin that sits exactly on a band edge on the same side
  const binHz = (n, fs) => 1 / (n * (1 / fs));

  function bandEnvelope2(X, n, fs, lo, hi) {
    const re = new Float64Array(n), im = new Float64Array(n), v = binHz(n, fs);
    for (let k = 0; k < X.re.length; k++) {
      const f = k * v;
      if (f >= lo && f < hi) { re[k] = 2 * X.re[k]; im[k] = 2 * X.im[k]; }
    }
    fft(re, im, 1);
    const e2 = new Float64Array(n);
    for (let k = 0; k < n; k++) e2[k] = (re[k] * re[k] + im[k] * im[k]) / (n * n);
    return e2;
  }

  function bestBand(x, fs, fmax, widths) {
    fmax = fmax || Math.min(6000, 0.45 * fs);
    widths = widths || [3000, 2000, 1500, 1000];
    const n = x.length, X = rfft(x);
    let best = [-Infinity, 0, fmax];
    for (const bw of widths) {
      const stop = fmax - bw + 1e-9;
      for (let i = 0; ; i++) {
        const lo = 200 + i * (bw / 4);
        if (lo >= stop) break;
        const e2 = bandEnvelope2(X, n, fs, lo, lo + bw);
        let s1 = 0, s2 = 0;
        for (let k = 0; k < n; k++) { s1 += e2[k]; s2 += e2[k] * e2[k]; }
        const kurt = (s2 / n) / ((s1 / n) * (s1 / n)) - 2;
        if (kurt > best[0]) best = [kurt, lo, lo + bw];
      }
    }
    return best;
  }

  function squaredEnvelopeSpectrum(x, fs, band) {
    const n = x.length, X = rfft(x);
    const e2 = bandEnvelope2(X, n, fs, band[0], band[1]);
    const mu = mean(e2), w = new Float64Array(n);
    for (let k = 0; k < n; k++) w[k] = (e2[k] - mu) * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (n - 1)));
    const S = rfft(w), mag = new Float64Array(S.re.length), fr = new Float64Array(S.re.length), v = binHz(n, fs);
    for (let k = 0; k < mag.length; k++) { mag[k] = Math.hypot(S.re[k], S.im[k]) / n; fr[k] = k * v; }
    return { fr, S: mag };
  }

  function lineSnrDb(fr, S, f0, tol, harmonics) {
    tol = tol || 0.02;
    harmonics = harmonics || [1, 2, 3];
    const out = [];
    for (const h of harmonics) {
      const c = h * f0;
      let peak = -Infinity, any = false;
      const ref = [];
      for (let k = 0; k < fr.length; k++) {
        const f = fr[k];
        const inWin = f >= c * (1 - tol) && f <= c * (1 + tol);
        if (inWin) { any = true; if (S[k] > peak) peak = S[k]; }
        else if (f >= c * 0.8 && f <= c * 1.2) ref.push(S[k]);
      }
      if (!any || !ref.length) continue;
      out.push(20 * Math.log10(peak / (median(ref) + 1e-18)));
    }
    return out.length ? out.reduce((a, b) => a + b, 0) / out.length : 0;
  }

  const PART = { BPFO: "outer race", BPFI: "inner race", BSF: "rolling element" };

  function orders(rollers, rollerDia, pitchDia, contactDeg) {
    const r = rollerDia / pitchDia * Math.cos(contactDeg * Math.PI / 180);
    return { BPFO: rollers / 2 * (1 - r), BPFI: rollers / 2 * (1 + r), BSF: pitchDia / (2 * rollerDia) * (1 - r * r), FTF: 0.5 * (1 - r) };
  }

  function diagnose(x, fs, shaftHz, ord, threshold) {
    threshold = threshold == null ? 10 : threshold;
    const xw = prewhiten(x);
    const [, lo, hi] = bestBand(xw, fs);
    const { fr, S } = squaredEnvelopeSpectrum(xw, fs, [lo, hi]);
    const scores = {
      BPFO: lineSnrDb(fr, S, ord.BPFO * shaftHz),
      BPFI: lineSnrDb(fr, S, ord.BPFI * shaftHz),
      BSF: lineSnrDb(fr, S, ord.BSF * shaftHz, 0.02, [2, 4]),
    };
    const top = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a));
    return { verdict: scores[top] >= threshold ? top : null, scores, band: [lo, hi], fr, S, lines: {
      BPFO: ord.BPFO * shaftHz, BPFI: ord.BPFI * shaftHz, BSF: ord.BSF * shaftHz } };
  }

  const api = { fft, rfft, irfft, prewhiten, bestBand, squaredEnvelopeSpectrum, lineSnrDb, orders, diagnose, PART };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Vigil = api;
})(typeof self !== "undefined" ? self : this);

"""VIGIL signal core.

Everything here is classical, explainable signal processing. No model is trained
on labelled faults: a machine is compared only against its own healthy history,
and a fault is named by matching the envelope spectrum against the defect
frequencies that the bearing's geometry predicts. That is the design choice the
whole system rests on, because defence and police fleets have almost no
labelled failure data to train on.
"""
import numpy as np
from scipy import signal


# Defect frequencies as multiples of shaft speed.
def bearing_orders(n_balls, ball_d, pitch_d, contact_deg):
    r = ball_d / pitch_d * np.cos(np.radians(contact_deg))
    return {
        "BPFO": n_balls / 2 * (1 - r),
        "BPFI": n_balls / 2 * (1 + r),
        "BSF": pitch_d / (2 * ball_d) * (1 - r * r),
        "FTF": 0.5 * (1 - r),
    }


# SKF 6205-2RS JEM, the CWRU drive-end bearing. Orders published by CWRU.
CWRU_6205 = {"BPFO": 3.5848, "BPFI": 5.4152, "BSF": 4.7135, "FTF": 0.39828}
# Rexnord ZA-2115, the IMS rig bearing (16 rollers, 0.331 in, 2.815 in, 15.17 deg).
IMS_ZA2115 = bearing_orders(16, 0.331, 2.815, 15.17)


def prewhiten(x):
    """Cepstral prewhitening: flatten the spectrum so that discrete gear, shaft
    and mains lines stop masking the weak impulsive bearing signature."""
    X = np.fft.rfft(x - np.mean(x))
    return np.fft.irfft(X / (np.abs(X) + 1e-12), n=len(x))


def best_band(x, fs, fmax=None, widths=(3000, 2000, 1500, 1000)):
    """Coarse kurtogram: the band whose envelope is most impulsive is where the
    bearing's impacts ring the structure. Capped at the node sensor's flat
    bandwidth (IIS3DWB, about 6 kHz) and kept at least 1 kHz wide so the third
    harmonic of the inner-race frequency still fits in the envelope."""
    fmax = fmax or min(6000.0, 0.45 * fs)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / fs)
    best = (-np.inf, 0.0, fmax)
    for bw in widths:
        for lo in np.arange(200.0, fmax - bw + 1e-9, bw / 4):
            m = (f >= lo) & (f < lo + bw)
            e2 = np.abs(signal.hilbert(np.fft.irfft(np.where(m, X, 0), n=len(x)))) ** 2
            k = np.mean(e2 ** 2) / np.mean(e2) ** 2 - 2
            if k > best[0]:
                best = (k, lo, lo + bw)
    return best


def squared_envelope_spectrum(x, fs, band):
    lo, hi = band
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / fs)
    a = signal.hilbert(np.fft.irfft(np.where((f >= lo) & (f < hi), X, 0), n=len(x)))
    e2 = np.abs(a) ** 2
    S = np.abs(np.fft.rfft((e2 - e2.mean()) * np.hanning(len(e2)))) / len(e2)
    return np.fft.rfftfreq(len(e2), 1 / fs), S


def line_snr_db(fr, S, f0, tol=0.02, harmonics=(1, 2, 3)):
    """Mean prominence (dB above local median) of the first harmonics of f0.
    The +-2% search window absorbs speed slip and geometry tolerance."""
    out = []
    for h in harmonics:
        c = h * f0
        win = (fr >= c * (1 - tol)) & (fr <= c * (1 + tol))
        ref = (fr >= c * 0.8) & (fr <= c * 1.2) & ~win
        if not win.any() or not ref.any():
            continue
        out.append(20 * np.log10(S[win].max() / (np.median(S[ref]) + 1e-18)))
    return float(np.mean(out)) if out else 0.0


FAULT_PARTS = {"BPFO": "outer race", "BPFI": "inner race", "BSF": "rolling element"}


def diagnose(x, fs, shaft_hz, orders, threshold_db=10.0):
    """Name the failing part, or say none can be named.

    Ball faults ring at twice the ball spin frequency (the ball strikes both
    races), so BSF is scored on its even harmonics."""
    xw = prewhiten(x)
    _, lo, hi = best_band(xw, fs)
    fr, S = squared_envelope_spectrum(xw, fs, (lo, hi))
    scores = {
        "BPFO": line_snr_db(fr, S, orders["BPFO"] * shaft_hz),
        "BPFI": line_snr_db(fr, S, orders["BPFI"] * shaft_hz),
        "BSF": line_snr_db(fr, S, orders["BSF"] * shaft_hz, harmonics=(2, 4)),
    }
    top = max(scores, key=scores.get)
    verdict = top if scores[top] >= threshold_db else None
    return {"verdict": verdict, "scores": scores, "band": (lo, hi), "fr": fr, "S": S}


def condition_features(x, fs, shaft_hz, orders):
    """Per-snapshot features for the health index: overall level, impulsiveness,
    and the three defect-line prominences."""
    x = x - np.mean(x)
    rms = np.sqrt(np.mean(x ** 2))
    kurt = np.mean(x ** 4) / rms ** 4
    crest = np.max(np.abs(x)) / rms
    d = diagnose(x, fs, shaft_hz, orders, threshold_db=np.inf)
    s = d["scores"]
    return np.array([np.log(rms), kurt, crest, s["BPFO"], s["BPFI"], s["BSF"]])


FEATURE_NAMES = ["log RMS", "kurtosis", "crest factor", "BPFO line", "BPFI line", "BSF line"]


# Smallest change in each feature the node can claim to have measured: a
# sensor re-seated on its magnet base, or a machine running warm, moves the
# overall level by a few percent and the line prominences by a decibel or so.
# Without this floor a bearing with a very steady first day alarms on drift.
FEATURE_FLOOR = np.array([0.05, 0.10, 0.10, 1.0, 1.0, 1.0])


def health_index(F, n_base, floor=FEATURE_FLOOR):
    """Robust z-score of each feature against the machine's own first n_base
    snapshots; the index is the worst feature. Median and MAD, not mean and
    standard deviation, so one odd snapshot in the learning window cannot
    widen the band."""
    base = F[:n_base]
    med = np.median(base, axis=0)
    mad = np.maximum(1.4826 * np.median(np.abs(base - med), axis=0), floor)
    Z = np.abs(F - med) / mad
    return Z.max(axis=1), Z


def running(F, n_base, frac=0.3):
    """Snapshots taken while the machine was stopped carry no information about
    its health: overall level under 30% of the healthy median."""
    return np.exp(F[:, 0]) >= frac * np.exp(np.median(F[:n_base, 0]))


def first_alarm(hi, n_base, z=6.0, persist=3, on=None):
    """First snapshot after learning where the index has stayed above z for
    persist consecutive running snapshots. Persistence is what keeps a single
    bump or a door slam from paging a mechanic."""
    run = 0
    for i in range(n_base, len(hi)):
        if on is not None and not on[i]:
            continue
        run = run + 1 if hi[i] >= z else 0
        if run >= persist:
            return i - persist + 1
    return None

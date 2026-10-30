# Yantra Nadi

Pulse diagnosis for machines. A clip-on vibration sensor that tells a mechanic which part of a generator, pump or vehicle is wearing out, days before it fails, without the internet.

Live demo: https://amayakavya.github.io/yantra-nadi/

## What is measured

All of it from the code in `analysis/`, run on two public bearing datasets.

**NASA IMS run-to-failure data** (three tests, 12 bearings, 2,065 hours). Each bearing learns its own first 24 hours and is never shown a failure.

| Run | Failed bearing | First warning before the rig stopped | Named as |
| --- | --- | --- | --- |
| 1 | 3, inner race | 256.2 h | inner race (11.2 h before) |
| 1 | 4, rolling element | 602.8 h | rolling element (585.1 h before) |
| 2 | 1, outer race | 67.7 h | outer race (67.7 h before) |
| 3 | 3, outer race | 42.0 h | outer race (42.0 h before) |

Healthy bearings: 5,366 bearing-hours. Eight alarms, all after the failing bearing had already warned, and in every case the failing bearing's sensor was the loudest on the shaft at that moment.

**Case Western Reserve University seeded faults** (52 drive-end recordings, 12 kHz). Named correctly 40, named wrong 2, declined 10. Inner race 12 of 12, outer race 25 of 28, rolling element 3 of 12.

## How the rules were set

The alarm thresholds, the per-feature repeatability floor, the running gate and the band search were fixed while looking at IMS run 2 and the Case Western set. IMS runs 1 and 3 were then scored once with nothing changed.

The IMS sampling rate is taken as 20,480 Hz because at that rate the outer-race line in run 2 lands at 236.0 Hz against 236.4 Hz predicted by the bearing geometry. At 20 kHz it lands 2.5% low. The Case Western normal-baseline files are 48 kHz (they carry an exact 360.000 Hz mains line) and are decimated to 12 kHz.

## Rerun

```
pip install numpy scipy matplotlib
# IMS: https://phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip, unpacked to ~/yantra-nadi-data/ims
# CWRU: https://engineering.case.edu/bearingdatacenter, files listed in analysis/cwru.py, to ~/yantra-nadi-data/cwru
cd analysis
python3 cwru.py
python3 ims.py 2 1 3
python3 export.py
```

About six minutes on an 8-core laptop.

## Not yet done

The hardware node (ESP32-S3 with ST's IIS3DWB accelerometer) is designed, not built. Nothing here has run on a police or forces machine. Vehicle drivelines at changing speed are out of scope until the idle-snapshot method is proven.

## Data

NASA Prognostics Data Repository, IMS bearing data, Center for Intelligent Maintenance Systems, University of Cincinnati. Case Western Reserve University Bearing Data Center.

Amaya Kavya, Electronics and Telecommunication Engineering, Ramrao Adik Institute of Technology, Navi Mumbai.

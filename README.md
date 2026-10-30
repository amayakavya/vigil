# VIGIL

Vibration Intelligence Grid for Integrity and Lifecycle. A clip-on vibration sensor that tells a mechanic which part of a generator, pump or motor is wearing out, days before it fails, with no internet connection.

Live: https://amayakavya.github.io/vigil/. The page runs the method on raw recordings, including a file you upload.

## What is measured

All of it from the code in `analysis/`, run on two public bearing datasets.

**NASA IMS run-to-failure data** (three tests, 12 bearings, four failures). Each bearing is learned from its first 24 hours and the system is never shown a failure. A warning is sustained once the alarm never goes quiet for more than 12 hours again. The controls are plain level alarms on the same snapshots with the same three-in-a-row rule.

| Failure | VIGIL, sustained | Level doubled | Level up 35% | Right part named, last 72 h |
| --- | --- | --- | --- | --- |
| Run 1, bearing 3, inner race | 256.2 h | 12.2 h | 71.5 h | 25 of 25 |
| Run 1, bearing 4, rolling element | 158.6 h | 107.7 h | 156.6 h | 75 of 78 |
| Run 2, bearing 1, outer race | 66.5 h | 46.8 h | 55.8 h | 371 of 371 |
| Run 3, bearing 3, outer race | 40.0 h | 24.7 h | 27.3 h | 176 of 182 |

Healthy bearings before any fault: 3,245 running hours, no alarm from VIGIL or either control. Seven single readings in run 3 crossed the alarm level and the three-in-a-row rule held them back. After each fault began, eight healthy bearings on the same shafts alarmed too, all later than the failing bearing and all with the failing bearing's sensor loudest on the shaft at that moment. Run 1, bearing 4 was first flagged 602.8 h out, intermittently, and its warning only held from 158.6 h.

**Case Western Reserve University seeded faults** (52 drive-end recordings, 12 kHz), used during development. Named correctly 40, named wrong 2, declined 10. Inner race 12 of 12, outer race 25 of 28, rolling element 3 of 12.

## How the rules were set

The first version named 26 of 52 on Case Western, because the band search chose the anti-alias edge, and alarmed on all three healthy bearings in NASA run 2 on level drifts of 7 to 14%. The band search was then held between 200 Hz and 6 kHz in bands at least 1 kHz wide, and each feature got a floor on its spread and a stopped-machine rule. Runs 1 and 3 were scored once after that, with nothing changed.

The IMS sampling rate is 20,480 Hz because the readme defines each file as a one-second snapshot of 20,480 points. The Case Western normal-baseline files are 48 kHz (they carry an exact 360.000 Hz mains line) and are decimated to 12 kHz.

## The browser version

`docs/vigil.js` is the same method in JavaScript. `node analysis/check_js.mjs` runs it on the nine recordings in `docs/data/samples` and compares it with what `analysis/vigil.py` says about the same samples: same verdict, same band, line scores within 0.0001 dB.

## Rerun

```
pip install numpy scipy matplotlib
# IMS: https://phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip, unpacked to ~/vigil-data/ims
# CWRU: https://engineering.case.edu/bearingdatacenter, files listed in analysis/cwru.py, to ~/vigil-data/cwru
cd analysis
python3 cwru.py
python3 ims.py 2 1 3
python3 export.py
python3 presets.py
node check_js.mjs
python3 verify_claims.py
```

About six minutes on an 8-core laptop.

## Not yet done

The hardware node (ESP32-S3 with ST's IIS3DWB accelerometer, within 3 dB to 6 kHz) is designed, not built. Nothing here has run on a police or forces machine. A machine damaged before installation would teach the node a damaged normal, and the fleet and ISO 20816 checks meant to catch that are not built. Vehicles need speed tracking, which is not built.

## Data

NASA Prognostics Data Repository, IMS bearing data, Center for Intelligent Maintenance Systems, University of Cincinnati. Case Western Reserve University Bearing Data Center. The background drawing is made with the drafting kit from amayakavya.com (`sheet/`).

Amaya Kavya, Electronics and Telecommunication Engineering, Ramrao Adik Institute of Technology, Navi Mumbai.

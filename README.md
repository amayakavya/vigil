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

## The firmware

`firmware/core/vigil.c` is the method in portable C99, for the node's ESP32-S3, in single precision with double accumulators. `firmware/test` checks it against the Python reference:

```
cd firmware/test
cc -std=c99 -O2 -DVIGIL_DOUBLE -o check_double check_core.c ../core/vigil.c -lm && ./check_double samples.txt
cc -std=c99 -O2 -o check_float check_core.c ../core/vigil.c -lm && ./check_float samples.txt
python3 replay_ims.py      # all twelve NASA bearings through the firmware's own learning and alarm logic
```

`firmware/node` is the ESP32-S3 application (PlatformIO, Arduino framework, NimBLE): an IIS3DWB driver written from datasheet DS12569 Rev 4, a 32,768-sample snapshot every ten minutes with the sample rate measured on each one, the day's learning kept through deep sleep and power cuts, and results over paired, encrypted Bluetooth or the USB cable. A press of the button wakes it for a handset, and it stays up for two minutes after the handset's last word. It builds with `pio run` to 562,257 bytes of flash and 30,784 of static RAM. It has not run on a board.

What the node learns, decides, keeps and says is `firmware/core/node.c`, portable C with nothing of the board in it. `firmware/node/src/main.cpp` is only pins, sensor, radio, flash and sleep. `firmware/wasm/build.sh` builds the same source to `docs/node.wasm` with zig, and `node analysis/check_node.mjs --nasa` runs that build through all twelve NASA bearings as a node would live them: every alarm and every name on the analysis's snapshot, 12 of 12 bearings, 37,856 snapshots.

## The handset

The node menu (`docs/handset.js`) is the phone on the maintenance round. It reads a node over Bluetooth or the USB cable with one set of lines (`docs/link.js`): its state, its last 48 hours of health index, a spot reading that never moves the alarm, and its raw recording with a CRC, which the phone analyses again with `docs/vigil.js` and sets beside the node's own answer. It writes the installation, clears a warning after the repair, prints or shares a job card, and keeps the round on the phone with no connection.

No board exists yet, so the handset carries a bench node: `docs/node.wasm`, started from the memory the firmware held after NASA test 2, bearing 1's first 570 snapshots, then given the next twelve recordings one at a time. `node analysis/check_node.mjs` drives the handset's own link code against it. The status, the trend and every sample arrive as the node holds them, the phone's line strengths are within 0.0001 dB of the node's in the same band, a spot reading leaves the node's memory byte for byte as it was, bad settings are refused, and a warning survives a power cut.

Bluetooth from a web page needs Chrome or Edge on Android or a computer. An iPhone's own browser does not allow it, so there the handset reads the bench node and keeps the round. A phone's accelerometer reaches a web page some sixty times a second, far short of a bearing's impacts, so the phone is the handset and never the sensor.

## The console

`docs/index.html` is one app in plain HTML, CSS and JavaScript, built for a phone first, in two versions that share everything underneath.

The simple version is what opens. It has two buttons, check a machine and demonstration, and then one screen: a verdict in a word (healthy, learning, check soon, replace bearing, not running), one sentence on what to do, a gauge of the health score against the alarm line, four readings, and the job card to send or print. The full version is one tap away and is driven by menus. It opens on a single question, whether a VIGIL node is with you. Yes leads to connecting it over Bluetooth or the USB cable, then to that node's own menu: its readings, a spot reading, its recording checked on the phone, its last 48 hours, the job card, its set-up. No leads to what can be seen with no hardware: the demonstration, the demo node, and a recording test.

The demonstration opens on a guide: seven steps through one real bearing failure, one sentence and one lit instrument at a time, with Back and Next. The last step opens the live board. The three test rigs on it are the three IMS run-to-failure tests from NASA's data repository, shown as rigs 1 to 3.

**Board.** The three run-to-failure tests replayed, three shafts with four bearings each. The left pane lists every bearing with its state and health index. The centre shows the selected bearing: its health index on a log scale, and under it, on the same time axis, the envelope spectrum of every snapshot as a waterfall, so a defect is seen arriving as a line at the frequency the bearing's geometry predicts. The right pane holds the job cards, the spares to draw and the log. Nothing is drawn ahead of the replay clock. The waterfall is real data: `analysis/waterfall.py` computes each column from one NASA snapshot with the method's own steps, and leaves a column empty where the rig was stopped.

**Node menu.** The phone on the maintenance round, described below under the handset.

**Recording.** The method run in the browser on nine reference recordings or on a file you choose.

It works offline once opened (`docs/sw.js`) and installs to a phone's home screen. The results, method and limits are in `docs/results.html`.

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
python3 waterfall.py
node check_js.mjs
node check_node.mjs --nasa   # the node application and the handset link, about 40 minutes
python3 verify_claims.py
```

About six minutes on an 8-core laptop.

## Not yet done

The hardware node (ESP32-S3 with ST's IIS3DWB accelerometer, within 3 dB to 6 kHz) is designed, not built, so the handset's Bluetooth pairing, its notification pacing and the cable have met no board. Nothing here has run on a police or forces machine. A machine damaged before installation would teach the node a damaged normal, and the fleet and ISO 20816 checks meant to catch that are not built. Vehicles need speed tracking, which is not built.

## Data

NASA Prognostics Data Repository, IMS bearing data, Center for Intelligent Maintenance Systems, University of Cincinnati. Case Western Reserve University Bearing Data Center. The background drawing is generated by `sheet/vigil_sheet.py`.

Amaya Kavya, Electronics and Telecommunication Engineering, Ramrao Adik Institute of Technology, Navi Mumbai.

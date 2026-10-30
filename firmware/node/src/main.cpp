// VIGIL sensor node: ESP32-S3 (8 MB PSRAM) and ST IIS3DWB.
//
// Every ten minutes it wakes, records 32,768 samples (1.23 s at 26,667 Hz),
// runs the VIGIL method on them (firmware/core, the same code the test bench
// checks against the Python analysis), updates the machine's state, reports
// it for 15 seconds, and sleeps. The first 144 running snapshots (a day) are
// the machine's own normal. The Wi-Fi library is never linked: results leave by
// encrypted Bluetooth, or over the USB cable where a site allows no radio.
//
// Not yet run on a board. The bench build starts November 2026.
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <SPI.h>
#include <esp_sleep.h>
#include "iis3dwb.h"
extern "C" {
#include "vigil.h"
}

static constexpr size_t N = 32768;              // one snapshot
static constexpr int N_BASE = 144;              // a day of ten-minute snapshots
static constexpr uint32_t PERIOD_S = 600;
static constexpr uint32_t REPORT_MS = 15000;
// While it learns, a snapshot counts only if the machine is visibly running:
// overall level above 25 mg RMS, four times the sensor's own noise (75 ug per
// root hertz over its 6.3 kHz band, datasheet table 3). A standby generator
// that runs for an hour a week learns from those hours alone. Design value,
// to be checked on the bench.
static constexpr float RUNNING_G = 0.025f;

static constexpr int PIN_SCK = 12, PIN_MISO = 13, PIN_MOSI = 11, PIN_CS = 10;
static const char *SVC_UUID = "7b1e0001-5c3a-4f6e-9a77-56494749c001";
static const char *STATUS_UUID = "7b1e0002-5c3a-4f6e-9a77-56494749c001";
static const char *CONFIG_UUID = "7b1e0003-5c3a-4f6e-9a77-56494749c001";

// What the node is fitted to, set at installation over Bluetooth or the cable.
struct Config {
  char id[24] = "VIGIL-0001";
  float rollers = 16, roller_dia = 0.331f, pitch_dia = 2.815f, contact_deg = 15.17f;   // NASA IMS rig bearing until set
  float rpm = 2000;
  uint8_t axis = 2;            // the axis normal to the mounting face
  uint32_t passkey = 246810;   // shown on the node's label, entered once when pairing
};

// Survives deep sleep in RTC memory; the learned normal is also kept in flash
// so a power cut does not throw away a day of learning.
RTC_DATA_ATTR static int learned = 0;
RTC_DATA_ATTR static float base_rows[N_BASE][VIGIL_NFEAT];
RTC_DATA_ATTR static vigil_state state;
RTC_DATA_ATTR static bool have_state = false;
RTC_DATA_ATTR static uint32_t snapshots = 0;
RTC_DATA_ATTR static float last_hi = 0, last_fs = 0;
RTC_DATA_ATTR static double last_f[VIGIL_NFEAT];

static Config cfg;
static Preferences prefs;
static SPIClass spi(FSPI);
static IIS3DWB sensor(spi, PIN_CS);
static NimBLECharacteristic *status_chr = nullptr;

static const char *partName(int p) {
  return p == VIGIL_BPFO ? "outer race" : p == VIGIL_BPFI ? "inner race" : p == VIGIL_BSF ? "rolling element" : "none";
}

static String statusLine() {
  char buf[200];
  const char *phase = !have_state ? "learning" : state.alarm || state.named != VIGIL_NONE ? "warning" : "normal";
  snprintf(buf, sizeof buf,
           "VIGIL1|id=%s|phase=%s|learned=%d/%d|snap=%lu|hi=%.2f|part=%s|outer=%.1f|inner=%.1f|ball=%.1f|rms_g=%.4f|fs=%.1f",
           cfg.id, phase, learned, N_BASE, (unsigned long)snapshots, last_hi, have_state ? partName(state.named) : "none",
           last_f[3], last_f[4], last_f[5], exp(last_f[0]), last_fs);
  return String(buf);
}

static void loadConfig() {
  prefs.begin("vigil", false);
  if (prefs.getBytesLength("cfg") == sizeof cfg) prefs.getBytes("cfg", &cfg, sizeof cfg);
  if (!have_state && prefs.getBytesLength("state") == sizeof state) {
    prefs.getBytes("state", &state, sizeof state);
    have_state = true;
    learned = N_BASE;
  }
}

static void relearn() {
  learned = 0;
  have_state = false;
  prefs.remove("state");
}

// "CLEAR" after a repair takes the warning down; "RELEARN" after a bearing is
// replaced starts a new normal; "SET key=value" sets the installation.
static void command(String c) {
  c.trim();
  if (c == "CLEAR") { state.alarm = 0; state.named = VIGIL_NONE; state.over = 0; state.named_run = 0; prefs.putBytes("state", &state, sizeof state); }
  else if (c == "RELEARN") relearn();
  else if (c.startsWith("SET ")) {
    String kv = c.substring(4);
    int eq = kv.indexOf('=');
    String k = kv.substring(0, eq), v = kv.substring(eq + 1);
    if (k == "id") v.toCharArray(cfg.id, sizeof cfg.id);
    else if (k == "rollers") cfg.rollers = v.toFloat();
    else if (k == "roller_dia") cfg.roller_dia = v.toFloat();
    else if (k == "pitch_dia") cfg.pitch_dia = v.toFloat();
    else if (k == "contact_deg") cfg.contact_deg = v.toFloat();
    else if (k == "rpm") cfg.rpm = v.toFloat();
    else if (k == "axis") cfg.axis = (uint8_t)v.toInt();
    else if (k == "passkey") cfg.passkey = (uint32_t)v.toInt();
    prefs.putBytes("cfg", &cfg, sizeof cfg);
    relearn();                    // a new machine, or new geometry, needs a new normal
  }
}

class ConfigWrite : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override { command(String(c->getValue().c_str())); }
};

static void analyse(float *x, void *work, size_t work_bytes) {
  float fs = sensor.capture(x, N, cfg.axis);
  last_fs = fs;
  if (fs <= 0) return;                                     // overrun: no reading this time
  vigil_ws ws;
  vigil_workspace_init(&ws, N, work, work_bytes);
  vigil_orders o = vigil_bearing_orders(cfg.rollers, cfg.roller_dia, cfg.pitch_dia, cfg.contact_deg);
  vigil_features(&ws, x, fs, cfg.rpm / 60.0, &o, last_f);
  snapshots++;
  if (!have_state) {
    if (exp(last_f[0]) < RUNNING_G) return;                // stopped: nothing to learn from
    for (int j = 0; j < VIGIL_NFEAT; j++) base_rows[learned][j] = (float)last_f[j];
    if (++learned == N_BASE) {
      static double rows[N_BASE * VIGIL_NFEAT];
      for (int i = 0; i < N_BASE; i++)
        for (int j = 0; j < VIGIL_NFEAT; j++) rows[i * VIGIL_NFEAT + j] = base_rows[i][j];
      vigil_learn(&state, rows, N_BASE);
      have_state = true;
      prefs.putBytes("state", &state, sizeof state);
    }
    return;
  }
  int was_alarm = state.alarm, was_named = state.named;
  last_hi = (float)vigil_watch(&state, last_f);
  // flash only when something a mechanic would act on changes; the running
  // counters live in RTC memory, and losing them to a power cut is harmless
  if (state.alarm != was_alarm || state.named != was_named) prefs.putBytes("state", &state, sizeof state);
}

static void report() {
  String line = statusLine();
  Serial.println(line);                                    // the cable path
  NimBLEDevice::init(cfg.id);
  NimBLEDevice::setSecurityAuth(true, true, true);         // bonding, MITM protection, LE Secure Connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
  NimBLEDevice::setSecurityPasskey(cfg.passkey);
  NimBLEServer *srv = NimBLEDevice::createServer();
  NimBLEService *svc = srv->createService(SVC_UUID);
  status_chr = svc->createCharacteristic(STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC |
                                                          NIMBLE_PROPERTY::READ_AUTHEN | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *cfg_chr = svc->createCharacteristic(CONFIG_UUID, NIMBLE_PROPERTY::WRITE |
                                                                             NIMBLE_PROPERTY::WRITE_ENC |
                                                                             NIMBLE_PROPERTY::WRITE_AUTHEN);
  cfg_chr->setCallbacks(new ConfigWrite());
  status_chr->setValue(line.c_str());
  svc->start();
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->start();
  uint32_t t0 = millis();
  while (millis() - t0 < REPORT_MS) {
    if (Serial.available()) { command(Serial.readStringUntil('\n')); status_chr->setValue(statusLine().c_str()); }
    delay(20);
  }
  NimBLEDevice::deinit(true);
}

void setup() {
  uint32_t woke = millis();
  Serial.begin(115200);
  loadConfig();
  spi.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS);
  static float *x = nullptr;
  static void *work = nullptr;
  size_t work_bytes = vigil_workspace_bytes(N);
  x = (float *)ps_malloc(N * sizeof(float));
  work = ps_malloc(work_bytes);
  if (!x || !work || !sensor.begin()) {
    Serial.println("VIGIL1|error=" + String(!x || !work ? "psram" : "sensor"));
  } else {
    analyse(x, work, work_bytes);
    sensor.powerDown();
  }
  report();
  uint32_t busy_s = (millis() - woke) / 1000;
  esp_sleep_enable_timer_wakeup((uint64_t)(PERIOD_S > busy_s ? PERIOD_S - busy_s : 1) * 1000000ULL);
  esp_deep_sleep_start();
}

void loop() {}

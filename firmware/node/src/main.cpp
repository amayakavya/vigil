// VIGIL sensor node: ESP32-S3 (8 MB PSRAM) and ST IIS3DWB.
//
// Every ten minutes it wakes, records 32,768 samples (1.23 s at 26,667 Hz),
// runs the VIGIL method on them, updates the machine's state, listens for 15
// seconds, and sleeps. The first 144 running snapshots (a day) are the
// machine's own normal. The Wi-Fi library is never linked: results leave by
// encrypted Bluetooth, or over the USB cable where a site allows no radio.
//
// This file is only the board: pins, sensor, radio, flash and sleep. What the
// node learns, decides and says is firmware/core/node.c, the same code the
// handset's bench node runs and analysis/check_node.mjs checks on NASA's data.
//
// A mechanic with a handset presses the button to wake it. It then stays up
// for two minutes after the last word from the handset, answers over the same
// lines on Bluetooth and the cable, and still takes its ten-minute snapshot on
// time while it talks.
//
// Not yet run on a board. The bench build starts November 2026.
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <SPI.h>
#include <atomic>
#include <driver/rtc_io.h>
#include <esp_sleep.h>
#include <sys/time.h>
#include "iis3dwb.h"
extern "C" {
#include "node.h"
}

static constexpr size_t N = 32768;               // one snapshot
static constexpr uint32_t REPORT_MS = 15000;     // a scheduled wake listens this long
static constexpr uint32_t SERVICE_MS = 120000;   // a handset or the button holds it awake this long after the last word
static constexpr uint32_t AWAKE_MAX_MS = 900000; // and never longer than this, whatever is attached
// The gap between notifications while a recording streams out. The stack
// drops a notification it has no buffer for and does not say so, which the
// handset would catch by CRC and ask again. Design value, to be set on the bench.
static constexpr uint32_t NOTIFY_GAP_MS = 10;

static constexpr int PIN_SCK = 12, PIN_MISO = 13, PIN_MOSI = 11, PIN_CS = 10;
static constexpr gpio_num_t PIN_BUTTON = GPIO_NUM_0;   // the DevKitC's BOOT button, low when pressed
static const char *SVC_UUID = "7b1e0001-5c3a-4f6e-9a77-56494749c001";
static const char *STATUS_UUID = "7b1e0002-5c3a-4f6e-9a77-56494749c001";   // the status line, read
static const char *RX_UUID = "7b1e0003-5c3a-4f6e-9a77-56494749c001";       // a command line, written
static const char *TX_UUID = "7b1e0004-5c3a-4f6e-9a77-56494749c001";       // the reply lines, notified

// Survives deep sleep in RTC memory; the learned normal and any warning are
// also kept in flash so a power cut does not throw away a day of learning.
RTC_DATA_ATTR static vnode node;

static vnode_config cfg;
static Preferences prefs;
static SPIClass spi(FSPI);
static IIS3DWB sensor(spi, PIN_CS);
static float *x = nullptr;
static void *work = nullptr;
static vigil_ws ws;
static vnode_reading spot;
static vnode_raw raw;                            // the samples the handset may ask for

static NimBLECharacteristic *status_chr = nullptr, *tx_chr = nullptr;
static std::atomic<bool> link_up{false}, link_secure{false}, have_pending{false};
static std::atomic<uint16_t> link_mtu{23};
static char pending[VNODE_LINE];

// The RTC keeps this counting through deep sleep. A power cut starts it, and
// the node's memory, again from zero.
static uint32_t nowS() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint32_t)tv.tv_sec;
}

// One line, down the cable if one is attached, and to the handset once it has
// paired: a line and its newline, in as few notifications as the MTU allows.
static void say(void *, const char *line) {
  if (Serial) Serial.println(line);
  if (!tx_chr || !link_secure) return;
  static uint8_t buf[VNODE_LINE + 80];
  size_t len = strlen(line);
  if (len > sizeof buf - 1) len = sizeof buf - 1;
  memcpy(buf, line, len);
  buf[len++] = '\n';
  size_t room = (size_t)link_mtu - 3;
  for (size_t at = 0; at < len && link_secure; at += room) {
    tx_chr->notify(buf + at, len - at < room ? len - at : room);
    delay(NOTIFY_GAP_MS);
  }
}

static void publish(bool aloud) {
  char line[VNODE_LINE + 80];
  if (!x || !work) snprintf(line, sizeof line, "VIGIL1|id=%s|fw=%d|error=psram", cfg.id, VNODE_FW);
  else vnode_status(&node, &cfg, nowS(), line, sizeof line);
  if (status_chr) status_chr->setValue((const uint8_t *)line, strlen(line));
  if (aloud) say(nullptr, line);
}

static void persist(int flags) {
  if (flags & VNODE_SAVE_CFG) prefs.putBytes("cfg", &cfg, sizeof cfg);
  if (flags & VNODE_SAVE_STATE) {
    if (node.have_state) prefs.putBytes("state", &node.st, sizeof node.st);
    else prefs.remove("state");
  }
}

static void load() {
  if (node.n_base == 0) vnode_init(&node);       // power-on: RTC memory starts as zeros
  vnode_config_default(&cfg);
  prefs.begin("vigil", false);
  if (prefs.getBytesLength("cfg") == sizeof cfg) prefs.getBytes("cfg", &cfg, sizeof cfg);
  if (!node.have_state && prefs.getBytesLength("state") == sizeof(vigil_state)) {
    vigil_state st;
    prefs.getBytes("state", &st, sizeof st);
    vnode_restore(&node, &st);
  }
}

// One snapshot into x. Returns the measured sample rate, or 0 when there is
// no sensor or the capture had a gap.
static float record() {
  if (!sensor.begin()) return 0;
  float fs = sensor.capture(x, N, cfg.axis);
  sensor.powerDown();
  return fs;
}

static void scheduled() {
  if (!x || !work) { publish(true); return; }
  float fs = record();
  persist(vnode_scheduled(&node, &cfg, &ws, x, fs, nowS()));
  raw.x = x; raw.n = N; raw.scale = IIS3DWB::G_PER_COUNT; raw.r = &node.last; raw.snap = node.snapshots; raw.spot = 0;
  publish(true);
}

static void handle(const char *line) {
  int flags = vnode_command(&node, &cfg, line, raw.r ? &raw : nullptr, nowS(), say, nullptr);
  persist(flags);
  if ((flags & VNODE_WANT_SPOT) && x && work) {
    float fs = record();
    vnode_spot(&node, &cfg, &ws, x, fs, &spot);
    raw.x = x; raw.n = N; raw.scale = IIS3DWB::G_PER_COUNT; raw.r = &spot; raw.snap = 0; raw.spot = 1;
    vnode_spot_reply(&node, &spot, say, nullptr);
  } else if (flags & VNODE_WANT_SPOT) {
    say(nullptr, "ERR SNAP no memory for a snapshot");
  }
  publish(false);
}

class LinkEvents : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, ble_gap_conn_desc *d) override {
    link_secure = d->sec_state.encrypted && d->sec_state.authenticated;
    link_up = true;
  }
  void onDisconnect(NimBLEServer *) override { link_up = false; link_secure = false; link_mtu = 23; }
  void onMTUChange(uint16_t mtu, ble_gap_conn_desc *) override { link_mtu = mtu; }
  // nothing is notified until the handset has paired with the passkey
  void onAuthenticationComplete(ble_gap_conn_desc *d) override { link_secure = d->sec_state.encrypted && d->sec_state.authenticated; }
};

// A command arrives on the Bluetooth task. It is only noted here and answered
// from the main loop, because a recording takes seconds to send.
class CommandWrite : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override {
    if (have_pending) return;                    // the handset sends one command at a time
    strncpy(pending, c->getValue().c_str(), sizeof pending - 1);
    pending[sizeof pending - 1] = 0;
    have_pending = true;
  }
};

static void radioOn() {
  NimBLEDevice::init(cfg.id);
  NimBLEDevice::setMTU(247);
  NimBLEDevice::setSecurityAuth(true, true, true);         // bonding, MITM protection, LE Secure Connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
  NimBLEDevice::setSecurityPasskey(cfg.passkey);
  NimBLEServer *srv = NimBLEDevice::createServer();
  srv->setCallbacks(new LinkEvents());
  srv->advertiseOnDisconnect(true);
  NimBLEService *svc = srv->createService(SVC_UUID);
  status_chr = svc->createCharacteristic(STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::READ_AUTHEN);
  NimBLECharacteristic *rx = svc->createCharacteristic(RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC |
                                                                    NIMBLE_PROPERTY::WRITE_AUTHEN);
  rx->setCallbacks(new CommandWrite());
  tx_chr = svc->createCharacteristic(TX_UUID, NIMBLE_PROPERTY::NOTIFY);
  publish(false);
  svc->start();
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);                              // the node's id rides in the scan response
  adv->start();
}

// Listen: 15 seconds on a scheduled wake, two minutes from the last word once
// a handset or the button has asked for attention. Plugged into a computer or
// a phone it is powered by the cable and the port would vanish if it slept, so
// it stays up and keeps taking its snapshots.
static void serve(bool engaged) {
  radioOn();
  uint32_t t0 = millis(), heard = t0;
  for (;;) {
    bool cabled = (bool)Serial;                  // a USB host is on the other end
    if (have_pending) { handle(pending); have_pending = false; heard = millis(); engaged = true; }
    if (Serial.available()) { handle(Serial.readStringUntil('\n').c_str()); heard = millis(); }
    if (link_up && !engaged) { engaged = true; heard = millis(); }
    if (vnode_due(&node, nowS())) scheduled();
    uint32_t t = millis();
    if (!cabled && (t - heard >= (engaged ? SERVICE_MS : REPORT_MS) || t - t0 >= AWAKE_MAX_MS)) break;
    delay(20);
  }
  tx_chr = nullptr; status_chr = nullptr;
  NimBLEDevice::deinit(true);
}

void setup() {
  Serial.begin(115200);
  load();
  spi.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS);
  size_t work_bytes = vigil_workspace_bytes(N);
  x = (float *)ps_malloc(N * sizeof(float));
  work = ps_malloc(work_bytes);
  if (x && work) vigil_workspace_init(&ws, N, work, work_bytes);
  bool button = esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0;
  if (vnode_due(&node, nowS())) scheduled();
  serve(button);
  rtc_gpio_pullup_en(PIN_BUTTON);
  rtc_gpio_pulldown_dis(PIN_BUTTON);
  esp_sleep_enable_ext0_wakeup(PIN_BUTTON, 0);
  esp_sleep_enable_timer_wakeup((uint64_t)vnode_sleep_s(&node, nowS()) * 1000000ULL);
  esp_deep_sleep_start();
}

void loop() {}

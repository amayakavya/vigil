#include "iis3dwb.h"

uint8_t IIS3DWB::read(uint8_t reg) {
  uint8_t v;
  readBytes(reg, &v, 1);
  return v;
}

void IIS3DWB::write(uint8_t reg, uint8_t v) {
  spi_.beginTransaction(set_);
  digitalWrite(cs_, LOW);
  spi_.transfer(reg & 0x7F);
  spi_.transfer(v);
  digitalWrite(cs_, HIGH);
  spi_.endTransaction();
}

void IIS3DWB::readBytes(uint8_t reg, uint8_t *buf, size_t n) {
  spi_.beginTransaction(set_);
  digitalWrite(cs_, LOW);
  spi_.transfer(reg | 0x80);            // MSB set: read
  for (size_t i = 0; i < n; i++) buf[i] = spi_.transfer(0);
  digitalWrite(cs_, HIGH);
  spi_.endTransaction();
}

bool IIS3DWB::begin() {
  pinMode(cs_, OUTPUT);
  digitalWrite(cs_, HIGH);              // CS high selects SPI idle, low selects SPI
  delay(10);
  if (read(WHO_AM_I) != ID) return false;
  write(CTRL3_C, 0x01);                 // SW_RESET, clears itself
  for (int i = 0; i < 100 && (read(CTRL3_C) & 0x01); i++) delay(1);
  write(CTRL3_C, 0x44);                 // BDU on, IF_INC on
  write(CTRL1_XL, CTRL1_XL_ON_16G);
  write(FIFO_CTRL3, 0x0A);              // batch the accelerometer at 26,667 Hz
  write(FIFO_CTRL4, 0x00);              // bypass until a capture starts
  return true;
}

void IIS3DWB::powerDown() {
  write(FIFO_CTRL4, 0x00);
  write(CTRL1_XL, 0x00);
}

float IIS3DWB::capture(float *x, size_t n, int axis) {
  write(FIFO_CTRL4, 0x00);              // bypass empties the FIFO
  write(FIFO_CTRL4, 0x06);              // continuous: oldest sample dropped if we fall behind
  size_t got = 0;
  // The rate is measured from samples produced, not samples read: at each
  // status read, produced = read so far + still waiting in the FIFO. Timing
  // only the reads would be off by however full the FIFO was at the start,
  // up to 16 ms in 1.2 s, as large as the error being corrected.
  uint32_t ta = 0, tb = 0;
  size_t pa = 0, pb = 0;
  bool first = true;
  uint8_t w[7];
  while (got < n) {
    uint8_t s1 = read(FIFO_STATUS1), s2 = read(FIFO_STATUS2);
    uint32_t now = micros();
    if (s2 & 0x40) return 0;            // overrun: a gap in the record, so the snapshot is void
    size_t ready = s1 | ((size_t)(s2 & 0x03) << 8);
    if (first) { ta = now; pa = got + ready; first = false; }
    else { tb = now; pb = got + ready; }
    // One sample per transaction: the datasheet does not document the FIFO
    // read address wrapping back to 78h, so a long burst is not relied on.
    // At 10 MHz a transaction takes about 15 us against a 37.5 us sample
    // period, and the 3 kB FIFO (438 samples, 16 ms) absorbs any jitter.
    for (size_t i = 0; i < ready && got < n; i++) {
      readBytes(FIFO_OUT_TAG, w, 7);
      if ((w[0] >> 3) != TAG_ACCEL) continue;
      int16_t v = (int16_t)(w[1 + 2 * axis] | (w[2 + 2 * axis] << 8));
      x[got++] = v * G_PER_COUNT;
    }
  }
  write(FIFO_CTRL4, 0x00);
  return (tb > ta && pb > pa) ? (pb - pa) / ((tb - ta) * 1e-6f) : NOMINAL_HZ;
}

// ST IIS3DWB over SPI, from datasheet DS12569 Rev 4. Only what the node needs:
// identify, reset, run the accelerometer at 26,667 Hz into the FIFO, and
// stream one axis out of the FIFO until a snapshot is full.
#pragma once
#include <Arduino.h>
#include <SPI.h>

class IIS3DWB {
 public:
  // registers (datasheet section 8)
  static constexpr uint8_t FIFO_CTRL3 = 0x09;   // BDR_XL[3:0]: 1010 = 26,667 Hz
  static constexpr uint8_t FIFO_CTRL4 = 0x0A;   // FIFO_MODE[2:0]: 000 bypass, 110 continuous
  static constexpr uint8_t WHO_AM_I = 0x0F;     // reads 0x7B
  static constexpr uint8_t CTRL1_XL = 0x10;     // XL_EN[2:0] = 101 on, FS[1:0]
  static constexpr uint8_t CTRL3_C = 0x12;      // BDU, IF_INC, SW_RESET
  static constexpr uint8_t FIFO_STATUS1 = 0x3A; // DIFF_FIFO[7:0]
  static constexpr uint8_t FIFO_STATUS2 = 0x3B; // overrun bit 6, DIFF_FIFO[9:8] in bits 1:0
  static constexpr uint8_t FIFO_OUT_TAG = 0x78; // tag, then X, Y, Z (16-bit, little-endian)
  static constexpr uint8_t ID = 0x7B;
  static constexpr uint8_t TAG_ACCEL = 0x02;    // TAG_SENSOR[4:0], datasheet table 92

  // full scale +-16 g (FS = 01): 0.488 mg per count. Machines with a damaged
  // bearing throw impacts of several g, which +-2 g or +-4 g would clip.
  static constexpr uint8_t CTRL1_XL_ON_16G = 0xA4;
  static constexpr float G_PER_COUNT = 0.000488f;
  static constexpr float NOMINAL_HZ = 26667.0f;

  IIS3DWB(SPIClass &spi, int cs) : spi_(spi), cs_(cs) {}

  bool begin();
  // Fill x[0..n) with acceleration in g on one axis (0 X, 1 Y, 2 Z). Returns the
  // sample rate measured against the ESP32's own clock over the capture, since
  // the datasheet allows the output rate to differ from nominal by a percent
  // or two, and every defect line is computed from it. Returns 0 on overrun.
  float capture(float *x, size_t n, int axis);
  void powerDown();

 private:
  SPIClass &spi_;
  int cs_;
  SPISettings set_{10000000, MSBFIRST, SPI_MODE3};   // 10 MHz is the datasheet maximum
  uint8_t read(uint8_t reg);
  void write(uint8_t reg, uint8_t v);
  void readBytes(uint8_t reg, uint8_t *buf, size_t n);
};

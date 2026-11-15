/* The VIGIL node's application, portable C99: what it learns, when it warns,
   what it keeps, and every line it says to a phone or down the cable. Nothing
   here touches a pin, a radio or a flash chip, so the same file runs on the
   ESP32-S3 (firmware/node), on a laptop and in a browser (firmware/wasm), and
   the handset's side of the conversation is checked against this code itself
   (analysis/check_node.mjs) rather than against a description of it.

   The board supplies four things: samples, a clock that keeps counting through
   deep sleep, somewhere to keep the config and the learned normal through a
   power cut, and a way to send a line. */
#ifndef VIGIL_NODE_H
#define VIGIL_NODE_H
#include <stddef.h>
#include <stdint.h>
#include "vigil.h"

#define VNODE_FW 2
#define VNODE_PERIOD_S 600          /* one snapshot every ten minutes */
#define VNODE_BASE 144              /* a day of them is the machine's normal */
#define VNODE_BASE_MAX 160
#define VNODE_TREND 288             /* the last 48 hours of health index, kept through deep sleep */
#define VNODE_LINE 256              /* no line the node sends is longer, newline included */
/* While it learns, a snapshot counts only if the machine is visibly running:
   overall level above 25 mg RMS, four times the sensor's own noise (75 ug per
   root hertz over its 6.3 kHz band, datasheet table 3). A standby generator
   that runs for an hour a week learns from those hours alone. Design value,
   to be checked on the bench. */
#define VNODE_RUNNING_G 0.025

/* what a command, or a snapshot, asks the board to do afterwards */
enum {
    VNODE_SAVE_CFG = 1,     /* the installation changed: keep it */
    VNODE_SAVE_STATE = 2,   /* the learned normal or a warning changed: keep it, or drop it if have_state is 0 */
    VNODE_WANT_SPOT = 4,    /* take a spot reading now, then call vnode_spot and vnode_spot_reply */
};

/* What the node is fitted to, set at installation from the handset. */
typedef struct {
    char id[24];
    double rollers, roller_dia, pitch_dia, contact_deg;   /* double, so the node computes the lines the analysis does */
    double rpm;
    uint32_t passkey;       /* on the node's label, entered once when pairing */
    uint8_t axis;           /* the axis normal to the mounting face */
} vnode_config;

/* One snapshot, reduced. */
typedef struct {
    double f[VIGIL_NFEAT];
    double hi;              /* health index against the learned normal, -1 when there is none or the machine was stopped */
    double fs;              /* the sample rate measured on this snapshot */
    double band_lo, band_hi;
    uint8_t valid, stopped;
} vnode_reading;

/* Everything that must survive deep sleep. The board keeps this in RTC memory. */
typedef struct {
    int32_t n_base, learned, have_state;
    uint32_t snapshots;                 /* scheduled snapshots taken since power-on */
    uint32_t last_at, next_due;         /* node clock, seconds */
    vigil_state st;
    vnode_reading last;                 /* the latest scheduled snapshot */
    vnode_reading raised;               /* the snapshot a warning was last raised on, for the job card */
    uint32_t raised_at, raised_snap;
    float base_rows[VNODE_BASE_MAX][VIGIL_NFEAT];
    uint16_t trend[VNODE_TREND];        /* health index x 100, oldest first from trend_head */
    uint16_t trend_n, trend_head;
} vnode;

#define VNODE_TREND_STOPPED 0xFFFF      /* machine stopped, or no reading */
#define VNODE_TREND_LEARNING 0xFFFE

/* The samples a reading came from, for a handset that asks to see them. */
typedef struct {
    const vreal *x;
    uint32_t n;
    double scale;                       /* g per count: x[k] / scale is the sensor's own integer */
    const vnode_reading *r;
    uint32_t snap;                      /* which scheduled snapshot, or 0 for a spot reading */
    uint8_t spot;
} vnode_raw;

typedef void (*vnode_emit)(void *ctx, const char *line);

void vnode_init(vnode *n);
void vnode_config_default(vnode_config *c);
/* After a power cut: the learned normal and any warning, read back from flash. */
void vnode_restore(vnode *n, const vigil_state *st);

/* Is the ten-minute snapshot due, and how long may the board sleep? */
int vnode_due(const vnode *n, uint32_t now);
uint32_t vnode_sleep_s(const vnode *n, uint32_t now);

/* The scheduled snapshot: learn from it, or score it and move the alarm.
   fs <= 0 means the capture was void. Returns VNODE_SAVE_STATE when the board
   should write the state to flash. */
int vnode_scheduled(vnode *n, const vnode_config *c, vigil_ws *ws, const vreal *x, double fs, uint32_t now);

/* A spot reading for a mechanic standing at the machine: measured and scored
   against the learned normal, and never fed to the alarm, so pressing a button
   three times cannot stand in for thirty minutes of evidence. */
void vnode_spot(const vnode *n, const vnode_config *c, vigil_ws *ws, const vreal *x, double fs, vnode_reading *out);
void vnode_spot_reply(const vnode *n, const vnode_reading *r, vnode_emit emit, void *ctx);

/* The status line: VIGIL1|id=...|phase=... Returns its length. */
int vnode_status(const vnode *n, const vnode_config *c, uint32_t now, char *buf, size_t cap);

/* One line from the handset or the cable. Every reply ends with a line that
   starts "OK " or "ERR ". Returns the VNODE_ flags above.
     STATUS            the status line
     TREND             the last 48 hours of health index
     WHY               the reading a standing warning was raised on
     RAW               the samples of the latest reading, with its line strengths and a CRC
     SNAP              a spot reading
     CLEAR             take a warning down after the repair
     RELEARN           learn a new normal after a bearing change
     SET key=value     id, rollers, roller_dia, pitch_dia, contact_deg, rpm, axis, passkey */
int vnode_command(vnode *n, vnode_config *c, const char *line, const vnode_raw *raw, uint32_t now,
                  vnode_emit emit, void *ctx);

uint32_t vnode_crc32(uint32_t crc, const uint8_t *p, size_t len);

#endif

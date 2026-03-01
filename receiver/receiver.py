#!/usr/bin/env python3
"""
PokeSAG Receiver — GNURadio + multimon-ng based POCSAG/FLEX decoder

Uses GNURadio for proper DSP signal processing:
  RTL-SDR (via gr-osmosdr) → freq_xlating_fir_filter (channelise) →
  quadrature_demod (FM demod) → rational_resampler (to 22050 Hz) →
  float_to_short → file_descriptor_sink (to multimon-ng stdin)

Decoded messages are written to PostgreSQL.
"""

import os
import time
import json
import re
import math
import signal
import threading
import subprocess
import logging

import psycopg2

from gnuradio import gr, blocks, analog, fft
from gnuradio import filter as gr_filter
from gnuradio.filter import firdes
import osmosdr

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------
DB_HOST = os.getenv("DB_HOST", "pokesag_db")
DB_NAME = os.getenv("DB_NAME", "pokesag")
DB_USER = os.getenv("DB_USER", "pokesag")
DB_PASS = os.getenv("DB_PASS", "pokesag")
DB_PORT = int(os.getenv("DB_PORT", "5432"))

DISCARD_SPAM = os.getenv("DISCARD_SPAM", "false").lower() == "true"
RTL_DEVICE_SERIAL = os.getenv("RTL_DEVICE_SERIAL")

# ---------------------------------------------------------------------------
# Channel configuration (loaded from file)
# ---------------------------------------------------------------------------
CHANNELS_FILE = os.getenv("CHANNELS_FILE", "/config/channels.json")

def _load_channels_config():
    """Load channel definitions from JSON config file.

    The config file must exist and contain center_freq, sample_rate,
    and a channels list.  The receiver will refuse to start without it.
    """
    if not os.path.isfile(CHANNELS_FILE):
        raise SystemExit(
            f"Channel config file not found: {CHANNELS_FILE}\n"
            "Set CHANNELS_FILE env var or mount a config at /config/channels.json"
        )
    with open(CHANNELS_FILE) as f:
        try:
            cfg = json.load(f)
        except json.JSONDecodeError:
            raise SystemExit(f"Invalid JSON in {CHANNELS_FILE}")

    # Basic validation
    for key in ("center_freq", "sample_rate", "channels"):
        if key not in cfg:
            raise SystemExit(f"Missing required key '{key}' in {CHANNELS_FILE}")
    if not cfg["channels"]:
        raise SystemExit(f"No channels defined in {CHANNELS_FILE}")

    # Expand protocol lists into multimon-ng -a flags
    for ch in cfg["channels"]:
        ch["protocols"] = [x for p in ch["protocols"] for x in ("-a", p)]
    return cfg

_config = _load_channels_config()
CENTER_FREQ = _config["center_freq"]
SAMPLE_RATE = _config["sample_rate"]
CHANNELS    = _config["channels"]

# ---------------------------------------------------------------------------
# SDR tuning
# ---------------------------------------------------------------------------
AUDIO_RATE  = 22050                # multimon-ng native sample rate

# Decimation from SAMPLE_RATE → CHANNEL_RATE
DECIMATION_IQ = 20
CHANNEL_RATE  = SAMPLE_RATE // DECIMATION_IQ   # 50 000 Hz

# Polyphase resample ratio: CHANNEL_RATE → AUDIO_RATE
from math import gcd as _gcd
_g = _gcd(AUDIO_RATE, CHANNEL_RATE)
RESAMPLE_UP   = AUDIO_RATE  // _g       # 441
RESAMPLE_DOWN = CHANNEL_RATE // _g      # 1000

# FM discriminator gain: channel_rate / (2π × max_deviation)
# POCSAG uses ±4.5 kHz deviation
FM_DEVIATION = 4_500
DEMOD_GAIN = CHANNEL_RATE / (2.0 * math.pi * FM_DEVIATION)   # ≈ 1.77

# Audio scaling for int16 output (≈ half of int16 max, matches rtl_fm)
AUDIO_SCALE = 16384.0

# Channel filter parameters
CHANNEL_BW   = 12_500   # Channel bandwidth (Hz)
TRANSITION_W = 3_000    # Filter transition width (Hz)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(name)s] %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("pokesag")

# Reduce noise from libraries
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("osmosdr").setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# Graceful shutdowns
# ---------------------------------------------------------------------------
running = True


def _sig_handler(signum, _frame):
    global running
    running = False
    log.info("Received signal %d - shutting down...", signum)


signal.signal(signal.SIGTERM, _sig_handler)
signal.signal(signal.SIGINT, _sig_handler)


# =========================================================================
# Database
# =========================================================================
class Database:
    def __init__(self):
        self._lock = threading.Lock()
        self._conn = None

    # -- connection --------------------------------------------------------
    def connect(self):
        self._conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT,
            database=DB_NAME, user=DB_USER, password=DB_PASS,
        )
        self._conn.autocommit = True

    def _reconnect(self):
        try:
            if self._conn and not self._conn.closed:
                self._conn.close()
        except Exception:
            pass
        self.connect()

    # -- schema ------------------------------------------------------------
    def create_tables(self):
        with self._conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS pages (
                    rx_date   timestamp NOT NULL,
                    source    text      NOT NULL,
                    recipient text      NOT NULL,
                    content   text      NOT NULL
                )
            """)
            cur.execute("""
                ALTER TABLE pages
                ADD COLUMN IF NOT EXISTS id integer
                GENERATED ALWAYS AS IDENTITY PRIMARY KEY
            """)
            cur.execute("""
                ALTER TABLE pages
                ADD COLUMN IF NOT EXISTS tsx tsvector
                GENERATED ALWAYS AS (
                    to_tsvector('simple', recipient || ' ' || content)
                ) STORED
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS search_idx ON pages USING GIN (tsx)
            """)
        log.info("Database tables ready.")

    # -- insert ------------------------------------------------------------
    def store_page(self, source: str, address: str, content: str):
        if DISCARD_SPAM and _is_spam(content):
            log.debug("Discarded spam from %s addr=%s", source, address)
            return
        with self._lock:
            try:
                with self._conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO pages (rx_date, source, recipient, content) "
                        "VALUES (NOW(), %s, %s, %s)",
                        (source, str(address), content),
                    )
            except Exception as exc:
                log.error("DB insert error: %s", exc)
                try:
                    self._reconnect()
                except Exception:
                    pass


def _is_spam(content: str) -> bool:
    t = content.lower().strip()
    if len(t) < 4:
        return True
    if "ha/modica" in t or "this is a test periodic" in t:
        return True
    return False


# =========================================================================
# multimon-ng subprocess wrapper
# =========================================================================
_RE_FLEX_PIPE = re.compile(
    r"^FLEX\|[^|]*\|[^|]*\|[^|]*\|(\d+)\|([A-Z]+)\|(.*)"
)
_RE_FLEX_SPACE = re.compile(
    r"^FLEX(?:_NEXT)?:\s+.*\[(\d+)\]\s+(\w+)\s+(.*)"
)
_RE_POCSAG = re.compile(
    r"^(POCSAG\d+):\s+Address:\s+(\d+)\s+Function:\s+\d+\s+"
    r"(?:Alpha|Numeric):\s*(.*)"
)


class MultimonChannel:
    """
    Manages one multimon-ng process for a named channel, parses its
    output (JSON preferred, text fallback), and writes decoded pages
    to the database.

    GNURadio writes audio directly to the subprocess stdin via a
    file_descriptor_sink, so there's no Python write() method.
    """

    def __init__(self, name: str, protocols: list, db: Database):
        self.name = name
        self._protocols = protocols
        self._db = db
        self._proc = None
        self._reader = None
        self._err_reader = None
        self._pages_decoded = 0

    def start(self):
        cmd = [
            "multimon-ng",
            "-t", "raw",
            "--json",          # structured output for FLEX & POCSAG
            "-e",              # hide empty POCSAG messages
            "-u",              # heuristically prune unlikely POCSAG
        ] + self._protocols + ["-"]
        log.info("Starting multimon-ng for %s: %s", self.name, " ".join(cmd))
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._reader = threading.Thread(
            target=self._read_loop, daemon=True, name=f"mmng-{self.name}",
        )
        self._reader.start()
        self._err_reader = threading.Thread(
            target=self._read_stderr, daemon=True, name=f"mmng-err-{self.name}",
        )
        self._err_reader.start()

    @property
    def stdin_fd(self):
        """Return a dup'd file descriptor for GNURadio to write to.

        Using os.dup() so GNURadio can own and close its copy
        independently of the subprocess's stdin fd.
        """
        return os.dup(self._proc.stdin.fileno())

    def _read_loop(self):
        assert self._proc and self._proc.stdout
        for raw in self._proc.stdout:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            self._handle(line)

    def _read_stderr(self):
        """Log multimon-ng stderr for diagnostics."""
        assert self._proc and self._proc.stderr
        for raw in self._proc.stderr:
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                log.debug("mmng [%s] stderr: %s", self.name, line)

    def _handle(self, line: str):
        """Handle one line of multimon-ng output, trying JSON first then falling back to text parsing."""

        # ---- Try JSON first (FLEX & POCSAG with --json) ----
        try:
            msg = json.loads(line)
            self._handle_json(msg)
            return
        except json.JSONDecodeError:
            pass

        # ---- Fallback: plain-text parsing (e.g. FLEX_NEXT) ----
        self._handle_text(line)

    def _handle_json(self, msg: dict):
        demod = msg.get("demod_name", "")

        # POCSAG
        if demod.startswith("POCSAG"):
            address = str(msg.get("address", ""))
            content = msg.get("alpha") or msg.get("numeric") or ""
            content = _clean(content)
            if content:
                source = f"{self.name} ({demod})"
                log.info("PAGE [%s] %s: %s", source, address, content)
                self._db.store_page(source, address, content)
                self._pages_decoded += 1
            return

        # FLEX (flex_alphanumeric, flex_numeric, flex_tone_only)
        if demod.startswith("flex"):
            capcode = str(msg.get("capcode", ""))
            content = msg.get("message", "")
            content = _clean(content)
            if content:
                baud = msg.get("sync_baud", "")
                source = f"{self.name} (FLEX {baud})"
                log.info("PAGE [%s] %s: %s", source, capcode, content)
                self._db.store_page(source, capcode, content)
                self._pages_decoded += 1
            return

    def _handle_text(self, line: str):
        # FLEX pipe-delimited: FLEX|ts|baud/…|cy.fr|capcode|TYPE|msg
        m = _RE_FLEX_PIPE.match(line)
        if m:
            capcode, msg_type, content = m.group(1), m.group(2), m.group(3)
            content = _clean(content)
            if content and msg_type in ("ALN", "NUM"):
                source = f"{self.name} (FLEX)"
                log.info("PAGE [%s] %s: %s", source, capcode, content)
                self._db.store_page(source, capcode, content)
                self._pages_decoded += 1
            return

        # FLEX / FLEX_NEXT space-separated
        m = _RE_FLEX_SPACE.match(line)
        if m:
            capcode, msg_type, content = m.group(1), m.group(2), m.group(3)
            content = _clean(content)
            if content and msg_type in ("ALN", "NUM"):
                source = f"{self.name} (FLEX)"
                log.info("PAGE [%s] %s: %s", source, capcode, content)
                self._db.store_page(source, capcode, content)
                self._pages_decoded += 1
            return

        # POCSAG text
        m = _RE_POCSAG.match(line)
        if m:
            demod, address, content = m.group(1), m.group(2), m.group(3)
            content = _clean(content)
            if content:
                source = f"{self.name} ({demod})"
                log.info("PAGE [%s] %s: %s", source, address, content)
                self._db.store_page(source, address, content)
                self._pages_decoded += 1
            return

    def log_stats(self):
        """Log throughput stats."""
        log.info(
            "MMNG [%s] %d pages decoded, pid=%s alive=%s",
            self.name, self._pages_decoded,
            self._proc.pid if self._proc else "?",
            self._proc.poll() is None if self._proc else False,
        )

    def stop(self):
        if self._proc:
            try:
                self._proc.stdin.close()
            except Exception:
                pass
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None


# =========================================================================
# GNURadio flowgraph
# =========================================================================
class PagerFlowgraph(gr.top_block):
    """
    GNURadio top_block that captures from one RTL-SDR and splits
    into three parallel FM-demod + multimon-ng output chains.

    RTL-SDR (1 MHz) → for each channel:
        freq_xlating_fir_filter (shift + LPF + decimate → 50 kHz)
        → quadrature_demod (FM discriminator)
        → rational_resampler (50 kHz → 22050 Hz)
        → float_to_short (scale to int16)
        → file_descriptor_sink (write to multimon-ng stdin)
    """

    def __init__(self, channel_fds):
        gr.top_block.__init__(self, "PokeSAG Receiver")

        # RTL-SDR source
        if RTL_DEVICE_SERIAL:
            args = f"rtl={RTL_DEVICE_SERIAL}"
        else:
            args = "rtl=0"

        log.info("Opening RTL-SDR: args=%s", args)
        self.src = osmosdr.source(args=args)
        self.src.set_sample_rate(SAMPLE_RATE)
        self.src.set_center_freq(CENTER_FREQ)
        self.src.set_gain_mode(True, 0)      # AGC
        self.src.set_if_gain(20, 0)
        self.src.set_bb_gain(20, 0)
        log.info(
            "SDR configured: %.3f MHz centre, %d Hz bandwidth, AGC on",
            CENTER_FREQ / 1e6, SAMPLE_RATE,
        )

        # Per-channel DSP chains
        for cfg, fd in zip(CHANNELS, channel_fds):
            name = cfg["name"]
            offset = cfg["offset_hz"]

            # Low-pass channel filter taps at input sample rate
            taps = firdes.low_pass(
                1.0,             # gain
                SAMPLE_RATE,     # sampling rate
                CHANNEL_BW,      # cutoff = 12.5 kHz
                TRANSITION_W,    # transition width = 3 kHz
                fft.window.WIN_HAMMING,
            )

            # Freq xlating FIR filter: shift + LPF + decimate in one block
            xlat = gr_filter.freq_xlating_fir_filter_ccf(
                DECIMATION_IQ,   # decimation factor
                taps,            # filter taps
                offset,          # center freq to select (offset from LO)
                SAMPLE_RATE,     # input sample rate
            )

            # FM quadrature demodulator
            quad = analog.quadrature_demod_cf(DEMOD_GAIN)

            # Rational resampler: 50 kHz → 22050 Hz
            resamp = gr_filter.rational_resampler_fff(
                interpolation=RESAMPLE_UP,     # 441
                decimation=RESAMPLE_DOWN,       # 1000
            )

            # Float → signed 16-bit PCM with scaling
            f2s = blocks.float_to_short(1, AUDIO_SCALE)

            # File descriptor sink → multimon-ng stdin
            sink = blocks.file_descriptor_sink(gr.sizeof_short, fd)

            # Connect the chain: source → xlat → quad → resamp → f2s → sink
            self.connect(self.src, xlat, quad, resamp, f2s, sink)

            log.info(
                "Channel '%s': %.3f MHz (offset %+d Hz), fd=%d, "
                "demod_gain=%.3f, scale=%.0f",
                name, (CENTER_FREQ + offset) / 1e6, offset, fd,
                DEMOD_GAIN, AUDIO_SCALE,
            )


def _clean(s: str) -> str:
    """Keep only printable ASCII (0x20–0x7E) and strip multimon-ng
    control-character markers like <ETX>."""
    s = re.sub(r"<ETX>", "", s)
    return "".join(c for c in s if 32 <= ord(c) < 127).strip()


def main():
    global running

    log.info("PokeSAG Receiver starting (GNURadio backend)")
    log.info(
        "DSP config: centre=%.3f MHz  sdr_rate=%d  channel_rate=%d  "
        "audio_rate=%d  demod_gain=%.3f  audio_scale=%.0f",
        CENTER_FREQ / 1e6, SAMPLE_RATE, CHANNEL_RATE,
        AUDIO_RATE, DEMOD_GAIN, AUDIO_SCALE,
    )
    log.info(
        "Resample: %d/%d (%.4f)  channels=%d",
        RESAMPLE_UP, RESAMPLE_DOWN,
        RESAMPLE_UP / RESAMPLE_DOWN, len(CHANNELS),
    )

    # ---- Wait for database ----
    db = Database()
    log.info("Waiting for database...")
    while running:
        try:
            db.connect()
            break
        except Exception as exc:
            log.warning("DB not ready: %s", exc)
            time.sleep(2)
    if not running:
        return
    log.info("Connected to database.")
    db.create_tables()

    mmng_channels = []
    fds = []
    for cfg in CHANNELS:
        mc = MultimonChannel(cfg["name"], cfg["protocols"], db)
        mc.start()
        fd = mc.stdin_fd
        fds.append(fd)
        mmng_channels.append(mc)
        log.info("multimon-ng for '%s' started, fd=%d", cfg["name"], fd)

    tb = None
    try:
        tb = PagerFlowgraph(fds)
        log.info("Starting GNURadio flowgraph...")
        tb.start()
        log.info("Flowgraph running — waiting for pages...")

        stats_interval = 30
        while running:
            time.sleep(stats_interval)
            for mc in mmng_channels:
                mc.log_stats()

    except KeyboardInterrupt:
        log.info("Keyboard interrupt received.")
    except Exception as exc:
        log.error("Fatal error: %s", exc, exc_info=True)
    finally:
        log.info("Shutting down...")
        if tb:
            tb.stop()
            tb.wait()
        for mc in mmng_channels:
            mc.stop()
        log.info("PokeSAG stopped.")


if __name__ == "__main__":
    main()

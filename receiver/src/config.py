"""Environment, channel config, SDR constants, and logging setup.

Imported for side effects: reads /config/channels.json at import time and
configures the root logger. Any module that imports from config will trigger
this once.
"""

import json
import logging
import math
from pathlib import Path

from environs import Env

HEARTBEAT_FILE = '/tmp/pokesag_heartbeat'  # written every stats cycle  # noqa: S108

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
_env = Env()
_env.read_env()

DB_HOST = _env.str('DB_HOST', 'db')
DB_NAME = _env.str('DB_NAME', 'pokesag')
DB_USER = _env.str('DB_USER', 'pokesag')
DB_PASS = _env.str('DB_PASS', 'pokesag')
DB_PORT = _env.int('DB_PORT', 5432)

DISCARD_SPAM = _env.bool('DISCARD_SPAM', False)
RTL_DEVICE_SERIAL = _env.str('RTL_DEVICE_SERIAL', '')

CHANNELS_FILE = _env.str('CHANNELS_FILE', '/config/channels.json')


# ---------------------------------------------------------------------------
# Channel config
# ---------------------------------------------------------------------------
def _load_config():
    """Load channel definitions from JSON config file.

    The config file must exist and contain center_freq and a channels
    list.  The receiver will refuse to start without it.
    """
    config_path = Path(CHANNELS_FILE)
    if not config_path.is_file():
        raise SystemExit(
            f'Channel config file not found: {CHANNELS_FILE}\n'
            'Set CHANNELS_FILE env var or mount a config at /config/channels.json'
        )
    with config_path.open() as f:
        try:
            cfg = json.load(f)
        except json.JSONDecodeError as exc:
            raise SystemExit(f'Invalid JSON in {CHANNELS_FILE}') from exc

    for key in ('center_freq', 'channels'):
        if key not in cfg:
            raise SystemExit(f"Missing required key '{key}' in {CHANNELS_FILE}")

    if not cfg['channels']:
        raise SystemExit(f'No channels defined in {CHANNELS_FILE}')

    for i, ch in enumerate(cfg['channels']):
        for key in ('name', 'offset_hz', 'protocols'):
            if key not in ch:
                raise SystemExit(f"Channel {i}: missing required key '{key}' in {CHANNELS_FILE}")
        if not ch['protocols']:
            raise SystemExit(f'Channel {i} ({ch["name"]}): protocols list is empty')
        # Expand protocol lists into multimon-ng -a flags
        ch['protocols'] = [x for p in ch['protocols'] for x in ('-a', p)]

    return cfg


_config = _load_config()
CENTER_FREQ = _config['center_freq']
CHANNELS = _config['channels']

# ---------------------------------------------------------------------------
# SDR tuning
# ---------------------------------------------------------------------------
SAMPLE_RATE = 1_000_000  # 1 MSPS (standard RTL-SDR rate)
AUDIO_RATE = 22050  # multimon-ng native sample rate

# Decimation from SAMPLE_RATE -> CHANNEL_RATE
DECIMATION_IQ = 20
CHANNEL_RATE = SAMPLE_RATE // DECIMATION_IQ  # 50 000 Hz

# Polyphase resample ratio: CHANNEL_RATE -> AUDIO_RATE
_g = math.gcd(AUDIO_RATE, CHANNEL_RATE)
RESAMPLE_UP = AUDIO_RATE // _g  # 441
RESAMPLE_DOWN = CHANNEL_RATE // _g  # 1000

# FM discriminator gain: channel_rate / (2*pi * max_deviation)
# POCSAG uses +/-4.5 kHz deviation
FM_DEVIATION = 4_500
DEMOD_GAIN = CHANNEL_RATE / (2.0 * math.pi * FM_DEVIATION)  # ~1.77

# Audio scaling for int16 output (~ half of int16 max, matches rtl_fm)
AUDIO_SCALE = 16384.0

# Channel filter parameters
CHANNEL_BW = 12_500  # Channel bandwidth (Hz)
TRANSITION_W = 3_000  # Filter transition width (Hz)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = _env.str('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format='%(asctime)s [%(name)s] %(levelname)s  %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('pokesag')

logging.getLogger('urllib3').setLevel(logging.WARNING)
logging.getLogger('osmosdr').setLevel(logging.WARNING)

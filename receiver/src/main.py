#!/usr/bin/env python3
"""PokeSAG Receiver entrypoint.

Connects to Postgres, runs schema migrations, spawns one multimon-ng
subprocess per channel, starts the GNURadio flowgraph feeding audio
into them, and blocks on the stats loop until SIGINT or SIGTERM.
"""

import contextlib
import signal
import threading
import time
from pathlib import Path

import config
from db.database import Database
from multimon import MultimonChannel
from radio import PagerFlowgraph

log = config.log

shutdown_event = threading.Event()


def _sig_handler(_signum, _frame):
    shutdown_event.set()


signal.signal(signal.SIGTERM, _sig_handler)
signal.signal(signal.SIGINT, _sig_handler)


def main():
    log.info('PokeSAG Receiver starting (GNURadio backend)')
    log.info(
        'DSP config: centre=%.3f MHz  sdr_rate=%d  channel_rate=%d  audio_rate=%d  demod_gain=%.3f  audio_scale=%.0f',
        config.CENTER_FREQ / 1e6,
        config.SAMPLE_RATE,
        config.CHANNEL_RATE,
        config.AUDIO_RATE,
        config.DEMOD_GAIN,
        config.AUDIO_SCALE,
    )
    log.info(
        'Resample: %d/%d (%.4f)  channels=%d',
        config.RESAMPLE_UP,
        config.RESAMPLE_DOWN,
        config.RESAMPLE_UP / config.RESAMPLE_DOWN,
        len(config.CHANNELS),
    )

    # ---- Wait for database ----
    db = Database()
    log.info('Waiting for database...')
    while not shutdown_event.is_set():
        try:
            db.connect()
            break
        except Exception as exc:
            log.warning('DB not ready: %s', exc)
            shutdown_event.wait(2)
    if shutdown_event.is_set():
        return
    log.info('Connected to database.')
    db.run_migrations()
    db.create_tables()

    # ---- Start multimon-ng subprocesses ----
    mms = []
    channel_fds = []
    for cfg in config.CHANNELS:
        mc = MultimonChannel(cfg['name'], cfg['protocols'], db)
        mc.start()
        fd = mc.stdin_fd
        channel_fds.append(fd)
        mms.append(mc)
        log.info("multimon-ng for '%s' started, fd=%d", cfg['name'], fd)

    # ---- Start GNURadio flowgraph ----
    radio = None
    try:
        radio = PagerFlowgraph(channel_fds)
        log.info('Starting GNURadio flowgraph...')
        radio.start()
        log.info('Flowgraph running - waiting for pages...')

        while not shutdown_event.wait(60):
            for instance in mms:
                instance.log_stats()
                if not instance.alive:
                    log.error('multimon-ng [%s] died, exiting for restart', instance.name)
                    raise SystemExit(1)
            with contextlib.suppress(OSError):
                Path(config.HEARTBEAT_FILE).write_text(str(time.time()))

    except KeyboardInterrupt:
        log.info('Keyboard interrupt received.')
    except Exception as exc:
        log.error('Fatal error: %s', exc, exc_info=True)
    finally:
        log.info('Shutting down...')
        if radio:
            radio.stop()
            radio.wait()
        for instance in mms:
            instance.stop()
        log.info('PokeSAG stopped.')


if __name__ == '__main__':
    main()

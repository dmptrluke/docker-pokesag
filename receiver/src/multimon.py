"""Supervise one multimon-ng subprocess per channel, route its stdout
through the POCSAG/FLEX parsers, and write decoded pages to the database."""

import contextlib
import json
import logging
import os
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path

import config
from db.database import Database
from decoding import flex, pocsag
from decoding.page import ParsedPage
from util import is_spam

log = logging.getLogger('pokesag')


class MultimonChannel:
    """One multimon-ng process for a named channel. GNURadio writes
    audio directly to the subprocess stdin via a file_descriptor_sink."""

    def __init__(self, name: str, protocols: list, db: Database):
        self.name = name
        self._protocols = protocols
        self._db = db
        self._proc = None
        self._reader = None
        self._err_reader = None
        self._pages_decoded = 0
        self._pages_dropped = 0
        self._pages_spam = 0
        self._dump_fp = None

    def start(self):
        cmd = [
            'multimon-ng',
            '-t',
            'raw',
            '--json',  # structured output for FLEX & POCSAG
            '-e',  # hide empty POCSAG messages
            '-u',  # heuristically prune unlikely POCSAG
            *self._protocols,
            '-',
        ]
        log.info('Starting multimon-ng for %s: %s', self.name, ' '.join(cmd))

        if config.MMNG_DUMP_DIR:
            dump_dir = Path(config.MMNG_DUMP_DIR)
            dump_dir.mkdir(parents=True, exist_ok=True)
            safe_name = self.name.replace('/', '_').replace(' ', '_')
            self._dump_fp = (dump_dir / f'mmng-{safe_name}.jsonl').open('a', buffering=1)
            log.info('mmng dump enabled for %s -> %s', self.name, self._dump_fp.name)

        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        self._reader = threading.Thread(
            target=self._read_stdout,
            daemon=True,
            name=f'mmng-{self.name}',
        )
        self._reader.start()

        self._err_reader = threading.Thread(
            target=self._read_stderr,
            daemon=True,
            name=f'mmng-err-{self.name}',
        )
        self._err_reader.start()

    @property
    def stdin_fd(self):
        """Dup'd file descriptor for GNURadio to write to, so it can own
        and close its copy independently of the subprocess stdin fd."""
        return os.dup(self._proc.stdin.fileno())

    def _read_stdout(self):
        if not self._proc or not self._proc.stdout:
            raise RuntimeError('subprocess not started')
        for raw in self._proc.stdout:
            line = raw.decode('utf-8', errors='replace').strip()
            if not line:
                continue
            if self._dump_fp is not None:
                self._dump_fp.write(line + '\n')
            self._handle(line)

    def _read_stderr(self):
        if not self._proc or not self._proc.stderr:
            raise RuntimeError('subprocess not started')
        for raw in self._proc.stderr:
            line = raw.decode('utf-8', errors='replace').strip()
            if line:
                log.debug('mmng [%s] stderr: %s', self.name, line)

    def _handle(self, line: str):
        """Parse one multimon-ng output line and store any resulting page."""
        page = None

        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            msg = None

        if msg is not None:
            page = pocsag.parse_json(msg) or flex.parse_json(msg)
        else:
            page = flex.parse_text(line) or pocsag.parse_text(line)

        if page is None:
            return

        self._store(page)

    def _store(self, page: ParsedPage):
        if config.DISCARD_SPAM and is_spam(page.content, page.content_type):
            log.debug('Discarded spam from %s addr=%s', self.name, page.recipient)
            self._pages_spam += 1
            return

        baud_tag = page.baud if page.baud is not None else '?'
        proto_char = 'P' if page.protocol == 'POCSAG' else 'F'
        log.info(
            'PAGE [%s %s%s] %s: %s',
            self.name,
            proto_char,
            baud_tag,
            page.recipient,
            page.content or '(tone)',
        )

        ok = self._db.store_page(
            channel=self.name,
            protocol=page.protocol,
            baud=page.baud,
            recipient=page.recipient,
            content=page.content,
            content_type=page.content_type,
            metadata=page.metadata,
            rx_date=datetime.now(UTC),
        )
        if ok:
            self._pages_decoded += 1
        else:
            self._pages_dropped += 1

    @property
    def alive(self):
        return self._proc is not None and self._proc.poll() is None

    def log_stats(self):
        log.info(
            'MMNG [%s] %d decoded, %d spam, %d db-failed, pid=%s alive=%s',
            self.name,
            self._pages_decoded,
            self._pages_spam,
            self._pages_dropped,
            self._proc.pid if self._proc else '?',
            self.alive,
        )

    def stop(self):
        if self._proc:
            with contextlib.suppress(Exception):
                self._proc.stdin.close()
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:
                with contextlib.suppress(Exception):
                    self._proc.kill()
            self._proc = None
        if self._dump_fp is not None:
            with contextlib.suppress(Exception):
                self._dump_fp.close()
            self._dump_fp = None

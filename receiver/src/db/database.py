"""Database connection and page insert."""

import json
import logging
import threading
from datetime import datetime

import psycopg

import config
from db.migrations import run_migrations as _run_migrations
from db.schema import create_tables as _create_tables

log = logging.getLogger('pokesag')


class Database:
    def __init__(self):
        self._lock = threading.Lock()
        self._conn = None

    # -- connection --------------------------------------------------------
    def connect(self):
        self._conn = psycopg.connect(
            host=config.DB_HOST,
            port=config.DB_PORT,
            dbname=config.DB_NAME,
            user=config.DB_USER,
            password=config.DB_PASS,
            autocommit=True,
        )

    def _reconnect(self):
        try:
            if self._conn and not self._conn.closed:
                self._conn.close()
        except Exception:  # noqa: S110
            pass
        self.connect()

    # -- schema ------------------------------------------------------------
    def create_tables(self):
        _create_tables(self._conn)
        log.info('Database tables ready.')

    def run_migrations(self):
        _run_migrations(self._conn)

    # -- insert ------------------------------------------------------------
    def store_page(
        self,
        channel: str,
        protocol: str,
        baud: int | None,
        recipient: str,
        content: str,
        content_type: str | None,
        metadata: dict,
        rx_date: datetime,
    ) -> bool:
        with self._lock:
            for attempt in range(2):
                try:
                    with self._conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO pages
                               (rx_date, channel, protocol, baud, recipient, content, content_type, metadata)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                            (
                                rx_date,
                                channel,
                                protocol,
                                baud,
                                recipient,
                                content,
                                content_type,
                                json.dumps(metadata),
                            ),
                        )
                    return True
                except Exception as exc:
                    if attempt == 0:
                        log.warning('DB insert error (will retry): %s', exc)
                        try:
                            self._reconnect()
                        except Exception as reconn_exc:
                            log.error('DB reconnect failed: %s', reconn_exc)
                            return False
                    else:
                        log.error('DB insert failed after retry: %s', exc)
        return False

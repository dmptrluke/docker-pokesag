"""v2 `pages` table DDL."""

CREATE_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS pages (
        id            bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        rx_date       timestamptz  NOT NULL,
        channel       text         NOT NULL,
        protocol      text         NOT NULL,
        baud          integer,
        recipient     text         NOT NULL,
        content       text         NOT NULL,
        content_type  text,
        metadata      jsonb        NOT NULL DEFAULT '{}'
    )
"""

INDEX_STATEMENTS = (
    'CREATE INDEX IF NOT EXISTS pages_rx_date_desc_idx ON pages (rx_date DESC)',
    'CREATE INDEX IF NOT EXISTS pages_channel_idx      ON pages (channel,  rx_date DESC)',
    'CREATE INDEX IF NOT EXISTS pages_protocol_idx     ON pages (protocol, baud, rx_date DESC)',
    'CREATE INDEX IF NOT EXISTS pages_recipient_idx    ON pages (recipient, rx_date DESC)',
    'CREATE INDEX IF NOT EXISTS pages_content_trgm_idx ON pages USING GIN (content gin_trgm_ops)',
    'CREATE INDEX IF NOT EXISTS pages_metadata_idx     ON pages USING GIN (metadata jsonb_path_ops)',
)


def create_indexes(cur):
    for stmt in INDEX_STATEMENTS:
        cur.execute(stmt)


def create_tables(conn):
    with conn.cursor() as cur:
        cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
        cur.execute(CREATE_TABLE_SQL)
        create_indexes(cur)

"""Schema migrations.

Each migration is a function taking a psycopg connection and is
expected to be idempotent via existence gates. `run_migrations`
invokes every registered migration in order on every startup.
"""

import logging

from db.schema import create_indexes

log = logging.getLogger('pokesag')


def run_migrations(conn):
    _v1_to_v2(conn)


def _v1_to_v2(conn):
    """Migrate a v1 `pages` table (source string column) to v2 in place.

    Gated on the presence of the legacy `source` column, so every step
    no-ops on fresh installs where that column never existed.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name='pages' AND column_name='source'
        """)
        if cur.fetchone() is None:
            return
        log.info('v1 schema detected - running migration to v2. This may take several minutes.')

        # 1. pg_trgm extension (also done by create_tables, safe to repeat)
        cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')

        # 2. Add nullable structured columns
        log.info('migration step 2: adding structured columns')
        cur.execute('ALTER TABLE pages ADD COLUMN IF NOT EXISTS channel       text')
        cur.execute('ALTER TABLE pages ADD COLUMN IF NOT EXISTS protocol      text')
        cur.execute('ALTER TABLE pages ADD COLUMN IF NOT EXISTS baud          integer')
        cur.execute('ALTER TABLE pages ADD COLUMN IF NOT EXISTS content_type  text')
        cur.execute("ALTER TABLE pages ADD COLUMN IF NOT EXISTS metadata      jsonb NOT NULL DEFAULT '{}'")

        # 2.5 Timezone sanity check before the one-way ALTER TYPE. Historical
        #     rows are NZT-naive; if that's wrong, the latest row interpreted as
        #     Pacific/Auckland wall-clock would land in the future relative to
        #     real UTC now. Abort rather than corrupt data.
        log.info('migration step 2.5: timezone sanity check')
        cur.execute("""
            SELECT
                (SELECT MAX(rx_date) FROM pages) AT TIME ZONE 'Pacific/Auckland'
                    > NOW() + interval '5 minutes'
        """)
        result = cur.fetchone()
        if result and result[0]:
            raise RuntimeError(
                'rx_date sanity check failed: latest historical row interpreted '
                'as Pacific/Auckland wall-clock is in the future relative to NOW(). '
                'Timezone interpretation may be wrong, aborting migration.'
            )

        # 3. Convert rx_date from naive timestamp to timestamptz. Historical
        #    rows in this deployment are NZT-naive; forks with different
        #    history must change this tz literal.
        log.info('migration step 3: converting rx_date to timestamptz (NZT-naive historical interpretation)')
        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='pages' AND column_name='rx_date'
                      AND data_type='timestamp without time zone'
                ) THEN
                    ALTER TABLE pages
                    ALTER COLUMN rx_date TYPE timestamptz
                    USING rx_date AT TIME ZONE 'Pacific/Auckland';
                END IF;
            END $$;
        """)

        # 4. Backfill structured columns from the old source string.
        log.info('migration step 4: backfilling channel/protocol/baud from source strings')
        # Pass 1: "Channel (POCSAG1200)" / "Channel (FLEX 1600)"
        cur.execute(r"""
            UPDATE pages SET
                channel  = regexp_replace(source, '\s+\((POCSAG|FLEX)\s*\d+\)$', ''),
                protocol = (regexp_match(source, '\((POCSAG|FLEX)\s*\d+\)$'))[1],
                baud     = NULLIF((regexp_match(source, '\((?:POCSAG|FLEX)\s*(\d+)\)$'))[1], '')::integer
            WHERE channel IS NULL
              AND source ~ '\s+\((POCSAG|FLEX)\s*\d+\)$'
        """)
        # Pass 2: "Channel (FLEX)" - no baud, text-fallback path
        cur.execute(r"""
            UPDATE pages SET
                channel  = regexp_replace(source, '\s+\(FLEX\)$', ''),
                protocol = 'FLEX',
                baud     = NULL
            WHERE channel IS NULL
              AND source ~ '\s+\(FLEX\)$'
        """)
        # Pass 3: lua-era bare channel names. Protocol is POCSAG (lua receiver
        # was POCSAG-only); baud is pinned from v1.0.0 receiver.lua per channel.
        cur.execute("""
            UPDATE pages SET
                channel  = source,
                protocol = 'POCSAG',
                baud     = CASE source
                    WHEN 'Spark 925'   THEN 1200
                    WHEN 'Spark 950'   THEN 1200
                    WHEN 'Telecom 925' THEN 1200
                    WHEN 'Telecom 950' THEN 1200
                    WHEN 'Ambulance'   THEN 512
                END
            WHERE channel IS NULL
              AND source IN ('Spark 925', 'Spark 950', 'Telecom 925', 'Telecom 950', 'Ambulance')
        """)
        # Validation: any row still missing channel or protocol is a backfill bug.
        cur.execute('SELECT count(*) FROM pages WHERE channel IS NULL OR protocol IS NULL')
        unbackfilled = cur.fetchone()[0]
        if unbackfilled > 0:
            raise RuntimeError(
                f'migration step 4: {unbackfilled} rows could not be backfilled '
                'from source. Aborting - source-string shapes are not fully '
                'covered by the regex passes.'
            )

        # 5. Promote id from integer to bigint
        log.info('migration step 5: promoting id to bigint')
        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='pages' AND column_name='id' AND data_type='integer'
                ) THEN
                    ALTER TABLE pages ALTER COLUMN id TYPE bigint;
                END IF;
            END $$;
        """)

        # 6. Lock channel and protocol as NOT NULL
        log.info('migration step 6: locking channel/protocol NOT NULL')
        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='pages' AND column_name='channel' AND is_nullable='YES'
                ) AND NOT EXISTS (SELECT 1 FROM pages WHERE channel IS NULL) THEN
                    ALTER TABLE pages ALTER COLUMN channel SET NOT NULL;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='pages' AND column_name='protocol' AND is_nullable='YES'
                ) AND NOT EXISTS (SELECT 1 FROM pages WHERE protocol IS NULL) THEN
                    ALTER TABLE pages ALTER COLUMN protocol SET NOT NULL;
                END IF;
            END $$;
        """)

        # 7. Drop legacy source column
        log.info('migration step 7: dropping legacy source column')
        cur.execute('ALTER TABLE pages DROP COLUMN IF EXISTS source')

        # 8. Drop legacy tsx full-text column
        log.info('migration step 8: dropping legacy tsx column and index')
        cur.execute('DROP INDEX IF EXISTS pages_tsx_idx')
        cur.execute('DROP INDEX IF EXISTS search_idx')
        cur.execute('ALTER TABLE pages DROP COLUMN IF EXISTS tsx')

        # 9. Create v2 indexes (shared DDL with create_tables, safe to repeat)
        log.info('migration step 9: creating v2 indexes')
        create_indexes(cur)

    log.info('v1 -> v2 migration complete.')

/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: pg-promise named-parameter placeholders */
import pgPromise from 'pg-promise';

const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME || 'pokesag';
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_PORT = process.env.DB_PORT || 5432;

const PAGE_COLUMNS = 'id, rx_date, channel, protocol, baud, recipient, content, content_type, metadata';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// /channels and /protocols are full-table aggregates. Values lag new
// channels/protocols by at most CACHE_TTL_MS.
const CACHE_TTL_MS = 60_000;

function memoTTL(fn) {
    let cached = null;
    let cachedAt = 0;
    let pending = null;
    return () => {
        const now = Date.now();
        if (cached && now - cachedAt < CACHE_TTL_MS) return Promise.resolve(cached);
        if (pending) return pending;
        pending = fn().then(
            value => {
                cached = value;
                cachedAt = Date.now();
                pending = null;
                return value;
            },
            err => {
                pending = null;
                throw err;
            },
        );
        return pending;
    };
}

function clampLimit(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
}

function encodeCursor(row) {
    const d = row.rx_date instanceof Date ? row.rx_date.toISOString() : String(row.rx_date);
    return Buffer.from(JSON.stringify({ d, i: Number(row.id) })).toString('base64url');
}

function decodeCursor(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (typeof parsed.d !== 'string' || !Number.isInteger(parsed.i)) return null;
        if (Number.isNaN(Date.parse(parsed.d))) return null;
        return parsed;
    } catch {
        return null;
    }
}

class PagesRepository {
    constructor(rep, pgp) {
        this.rep = rep;
        this.pgp = pgp;
        this.channels = memoTTL(() => this._channelsUncached());
        this.protocols = memoTTL(() => this._protocolsUncached());
    }

    // List pages with composable filters and cursor-based pagination.
    // Returns { items, next_cursor?, has_more }.
    async list(filters = {}) {
        const where = [];
        const params = {};

        if (filters.channel) {
            params.channel = filters.channel;
            where.push('channel = ${channel}');
        }
        if (filters.protocol) {
            params.protocol = filters.protocol;
            where.push('protocol = ${protocol}');
        }
        if (filters.baud !== undefined && filters.baud !== null && filters.baud !== '') {
            const baud = parseInt(filters.baud, 10);
            if (Number.isFinite(baud)) {
                params.baud = baud;
                where.push('baud = ${baud}');
            }
        }
        if (filters.recipient) {
            params.recipient = filters.recipient;
            where.push('recipient = ${recipient}');
        }
        if (filters.content_type) {
            params.content_type = filters.content_type;
            where.push('content_type = ${content_type}');
        }
        if (filters.q) {
            params.q = `%${filters.q}%`;
            where.push('content ILIKE ${q}');
        }
        if (filters.since) {
            params.since = filters.since;
            where.push('rx_date >= ${since}');
        }
        if (filters.until) {
            params.until = filters.until;
            where.push('rx_date <= ${until}');
        }

        const limit = clampLimit(filters.limit);
        params.fetch_limit = limit + 1;

        // Cursor and offset are mutually exclusive. Cursor wins if both are supplied.
        const cursor = decodeCursor(filters.cursor);
        let offsetClause = '';
        if (cursor) {
            params.cursor_d = cursor.d;
            params.cursor_i = cursor.i;
            where.push('(rx_date, id) < (${cursor_d}::timestamptz, ${cursor_i}::bigint)');
        } else if (filters.offset !== undefined && filters.offset !== null && filters.offset !== '') {
            const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
            params.offset = offset;
            offsetClause = ' OFFSET ${offset}';
        }

        const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
        const sql =
            `SELECT ${PAGE_COLUMNS} FROM pages${whereClause}` +
            ' ORDER BY rx_date DESC, id DESC' +
            ' LIMIT ${fetch_limit}' +
            offsetClause;

        const rows = await this.rep.any(sql, params);
        const has_more = rows.length > limit;
        const items = has_more ? rows.slice(0, limit) : rows;
        const result = { items, has_more };
        if (has_more) {
            result.next_cursor = encodeCursor(items[items.length - 1]);
        }
        return result;
    }

    getById(id) {
        return this.rep.oneOrNone(
            `SELECT ${PAGE_COLUMNS} FROM pages WHERE id = $1::bigint`,
            [id],
        );
    }

    _channelsUncached() {
        return this.rep.any(
            `SELECT channel, count(*)::bigint AS count FROM pages
             GROUP BY channel ORDER BY channel`,
        );
    }

    _protocolsUncached() {
        return this.rep.any(
            `SELECT protocol, baud, count(*)::bigint AS count FROM pages
             GROUP BY protocol, baud ORDER BY protocol, baud`,
        );
    }
}

export const pgp = pgPromise({
    extend(obj) {
        obj.pages = new PagesRepository(obj, pgp);
    },
});

export const db = pgp({
    user: DB_USER,
    password: DB_PASS,
    host: DB_HOST,
    database: DB_NAME,
    port: DB_PORT,
});

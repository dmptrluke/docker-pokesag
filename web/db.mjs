import pgPromise from 'pg-promise';

const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME || 'pokesag';
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_PORT = process.env.DB_PORT || 5432;

class PagesRepository {
    constructor(rep, pgp) {
        this.rep = rep;
        this.pgp = pgp;
    }

    latest() {
        return this.rep.any(`SELECT rx_date, source, recipient, content FROM pages 
        ORDER BY rx_date DESC, recipient ASC LIMIT 150`);
    }

    search(query) {
        return this.rep.any(`SELECT rx_date, source, recipient, content FROM pages WHERE tsx @@ websearch_to_tsquery('simple', $1)
        ORDER BY rx_date DESC, recipient ASC LIMIT 150`, [query]);
    }

    search_basic(query) {
        return this.rep.any(`SELECT rx_date, source, recipient, content FROM pages WHERE content ILIKE $1 OR recipient=$2
        ORDER BY rx_date DESC, recipient ASC LIMIT 150`, [`%${query}%`, query]);
    }
}

export const pgp = pgPromise({
    extend(obj, dc) {
        obj.pages = new PagesRepository(obj, pgp);
    }
});

export const db = pgp ({
    user: DB_USER,
    password: DB_PASS,
    host: DB_HOST,
    database: DB_NAME,
    port: DB_PORT,
});

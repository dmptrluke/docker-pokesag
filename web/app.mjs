import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import express from 'express';
import compression from 'compression';
import { db } from './db.mjs';

const __dirname = dirname(new URL(import.meta.url).pathname);

/***************
 * HTTP Server *
 ***************/

let app = express ();
let port = process.env.PORT || 8000;

app.use(compression())

// Serve tooltips.json from /config if available, otherwise return an empty object.
// This allows the file to be mounted as a config volume rather than baked into the image.
const TOOLTIP_FILE = process.env.TOOLTIP_FILE || '/config/tooltips.json';
app.get('/tooltips.json', async (_req, res) => {
    try {
        const data = await readFile(TOOLTIP_FILE, 'utf8');
        res.type('application/json').send(data);
    } catch {
        res.type('application/json').send('{}');
    }
});

app.use (express.static (resolve (__dirname, './client/public'), { 'index': ['index.html'] } ));
app.use (express.static (resolve (__dirname, './client/dist')));

/* A small wrapper around a app.get handler!
   This abstracts away generic code that is used on all api requests. */
function GET(url, handler) {
    app.get(url, async (req, res) => {
        try {
            const data = await handler(req);
            res.json({
                success: true,
                data
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message || error
            });
        }
    });
}

function offset(req) {
    return Math.max (0, (parseInt (req.params.page) - 1) * 100) || 0;
}

GET('/pages/', () => db.pages.latest ());
GET('/pages/:page/', req => db.pages.latest (offset (req)));

GET('/pages/search/ft/:q/', req => db.pages.search (req.params.q));
GET('/pages/search/ft/:q/:page/', req => db.pages.search (req.params.q, offset (req)));

GET('/pages/search/basic/:q/', req => db.pages.search_basic (req.params.q));
GET('/pages/search/basic/:q/:page/', req => db.pages.search_basic (req.params.q, offset (req)));

// Search by source address only, e.g. "1234567890" or "123%". We need this because our legacy DB scheme doesn't index the source field
GET('/pages/search/source/:q/', req => db.pages.search_source (req.params.q));
GET('/pages/search/source/:q/:page/', req => db.pages.search_source (req.params.q, offset (req)));

let server = app.listen (port, '::', () => {
    console.log ('Listening on port %s.', server.address ().port);
});

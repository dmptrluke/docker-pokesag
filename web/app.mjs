import { resolve, dirname } from 'path';
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
    return Math.max (0, (parseInt (req.params.page) - 1) * 150) || 0;
}

GET('/pages/', () => db.pages.latest ());
GET('/pages/:page/', req => db.pages.latest (offset (req)));

GET('/pages/search/ft/:q/', req => db.pages.search (req.params.q));
GET('/pages/search/ft/:q/:page/', req => db.pages.search (req.params.q, offset (req)));

GET('/pages/search/basic/:q/', req => db.pages.search_basic (req.params.q));
GET('/pages/search/basic/:q/:page/', req => db.pages.search_basic (req.params.q, offset (req)));

let server = app.listen (port, '::', () => {
    console.log ('Listening on port %s.', server.address ().port);
});

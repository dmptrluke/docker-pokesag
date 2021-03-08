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
            res.json({
                success: false,
                error: error.message || error
            });
        }
    });
}

GET('/pages/', () => db.pages.latest());

GET('/pages/search/ft/:string/', req => {
    const query = req.params.string;
    return db.pages.search(query);
});

GET('/pages/search/basic/:string/', req => {
    const query = req.params.string;
    return db.pages.search_basic(query);
});

let server = app.listen (port, '::', () => {
    console.log ('Listening on port %s.', server.address ().port);
});

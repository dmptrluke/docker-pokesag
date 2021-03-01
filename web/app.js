/*
 * Joppy Furr, 2018
 */
const express = require ('express');
const postgres = require ('pg').Client;

const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME || 'pokesag';
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_PORT = process.env.DB_PORT || 5432;

/*********************
 * Utility functions *
 *********************/

function clean_rows (rows)
{
    for (i = 0; i < rows.length; i++)
    {
        /* Remove the T, and chop off the milliseconds. */
        rows[i].rx_date = rows[i].rx_date.toISOString ().slice (0,19).replace ('T', ' ');
    }
}


/***********************
 * Database Connection *
 ***********************/

let db = new postgres (
    {
        user: DB_USER,
        password: DB_PASS,
        host: DB_HOST,
        database: DB_NAME,
        port: DB_PORT,
    } );
db.connect ();


/***************
 * HTTP Server *
 ***************/

let app = express ();
let port = process.env.PORT || 8000;

app.use (express.static ('./client/public', { 'index': ['index.html'] } ));
app.use (express.static ('./client/dist'));



/* API to retrieve the 100 most recent pages */
app.get ('/Pages/', function onListenEvent (req, res) {
    db.query ('SELECT * FROM pages ORDER BY rx_date DESC LIMIT 100', (query_err, query_res) => {
        if (query_err) {
            throw query_err;
        }
        clean_rows (query_res.rows);
        res.send (query_res.rows);
    });
});

/* API to retrieve all pages matching a string */
app.get ('/Pages/Search/:type/:string/', function onListenEvent (req, res) {
    if (req.params.type == 'ft') {
        let search_string = decodeURIComponent(req.params.string);
        db.query ("SELECT * FROM pages WHERE tsx @@ websearch_to_tsquery('simple', $1) ORDER BY rx_date DESC LIMIT 100", [search_string], (query_err, query_res) => {
            if (query_err) {
                throw query_err;
            }
            clean_rows (query_res.rows);
            res.send (query_res.rows);
        });
    } else {
        let search_string = decodeURIComponent(req.params.string).replace (/[#%.?\/\\]/g, '');
        db.query ("SELECT * FROM pages WHERE content ILIKE $1 OR recipient=$2 ORDER BY rx_date DESC LIMIT 100", ['%' + search_string + '%', search_string], (query_err, query_res) => {
            if (query_err) {
                throw query_err;
            }
            clean_rows (query_res.rows);
            res.send (query_res.rows);
        });
    }

});

let server = app.listen (port, '::', function () {
    console.log ('Listening on port %s.', server.address ().port);
});
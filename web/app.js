/*
 * Joppy Furr, 2018
 */
const express = require ('express');
const postgres = require ('pg').Client;

const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;
const DB_HOST = process.env.DB_HOST;
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
        password: DB_PASSWORD,
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

app.use (express.static ('Client', { 'index': ['main.html'] } ));

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
app.get ('/Pages/Search/:string/', function onListenEvent (req, res) {
    db.query ("SELECT * from pages WHERE tsx @@ to_tsquery($1) ORDER BY rx_date DESC LIMIT 100", req.params.string, (query_err, query_res) => {
        if (query_err) {
            throw query_err;
        }
        clean_rows (query_res.rows);
        res.send (query_res.rows);
    });
});

let server = app.listen (port, '::', function () {
    console.log ('Listening on port %s.', server.address ().port);
});

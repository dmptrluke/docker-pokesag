import { resolve } from 'path';
import { readFile } from 'fs/promises';
import express from 'express';
import compression from 'compression';
import { db } from './db.mjs';

const __dirname = import.meta.dirname;

const app = express();
const port = process.env.PORT || 8000;

app.use(compression());

const TOOLTIP_FILE = process.env.TOOLTIP_FILE || '/config/tooltips.json';
let tooltipsData = '{}';
try {
    tooltipsData = await readFile(TOOLTIP_FILE, 'utf8');
} catch {
    tooltipsData = '{}';
}
app.get('/tooltips.json', (_req, res) => {
    res.type('application/json').send(tooltipsData);
});

app.use(express.static(resolve(__dirname, './client/public'), { index: ['index.html'], maxAge: '1h' }));
app.use(express.static(resolve(__dirname, './client/dist'), { maxAge: '7d' }));

function GET(url, handler) {
    app.get(url, async (req, res) => {
        try {
            const data = await handler(req);
            res.json({ success: true, data });
        } catch (error) {
            if (error && error.status === 404) {
                res.status(404).json({ success: false, error: 'Not found' });
                return;
            }
            console.error('API error:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });
}

GET('/pages', req => db.pages.list(req.query));
GET('/pages/:id', async req => {
    const row = await db.pages.getById(req.params.id);
    if (!row) {
        const err = new Error('not found');
        err.status = 404;
        throw err;
    }
    return row;
});
GET('/channels', () => db.pages.channels());
GET('/protocols', () => db.pages.protocols());

const server = app.listen(port, '::', () => {
    console.log('Listening on port %s.', server.address().port);
});

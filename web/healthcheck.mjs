import http from 'http';

const port = parseInt(process.env.PORT, 10) || 8000;

const request = http.request({ host: 'localhost', port }, (res) => {
    process.exit(res.statusCode === 200 ? 0 : 1);
});

request.setTimeout(2000, () => {
    request.destroy();
    process.exit(1);
});

request.on('error', () => {
    process.exit(1);
});

request.end();

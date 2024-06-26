const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

const keywordsToUrls = {
    'ithub': ['https://ithub.ru'],
    'news': ['https://www.rbc.ru/', 'https://lenta.ru/'],
    'sport': ['https://www.championat.com/news/1.html', 'https://www.sport-express.ru/news/'],
    'music': ['https://dl.last.fm/static/1719401065/131564297/296ba3a177ede22c5142c2c9b3fc09d86afe659aa4bab7b9a2bb53dd7820ab96/Cloud+Nothings+-+Stay+Useless.mp3']

};

// Максимальное количество одновременных загрузок и скорость на поток (байт в секунду)
const config = {
    maxConcurrentDownloads: 2,
    bytesPerSecondPerThread: 102400 // 100 KB per second per thread
};

let activeDownloads = 0;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve downloaded files
app.use('/downloads', express.static(path.join(__dirname, '../downloads')));

const wss = new WebSocket.Server({
    noServer: true
});

wss.on('connection', ws => {
    ws.on('message', async message => {
        const {
            type,
            keyword,
            url
        } = JSON.parse(message);

        if (type === 'get-urls') {
            const urls = keywordsToUrls[keyword] || [];
            ws.send(JSON.stringify({
                type: 'urls',
                urls
            }));
        } else if (type === 'download') {
            if (activeDownloads < config.maxConcurrentDownloads) {
                activeDownloads++;
                try {
                    const response = await axios.get(url, {
                        responseType: 'stream'
                    });

                    const totalLength = parseInt(response.headers['content-length'], 10);
                    const chunkSize = Math.ceil(totalLength / config.maxConcurrentDownloads);
                    let downloadedLength = 0;

                    response.data.on('data', chunk => {
                        downloadedLength += chunk.length;
                        ws.send(JSON.stringify({
                            type: 'progress',
                            progress: downloadedLength / totalLength,
                            threadCount: activeDownloads
                        }));
                    });

                    const filePath = path.join(__dirname, '../downloads', path.basename(url));
                    response.data.pipe(fs.createWriteStream(filePath));

                    response.data.on('end', () => {
                        activeDownloads--;
                        ws.send(JSON.stringify({
                            type: 'done',
                            filePath: `/downloads/${path.basename(url)}`
                        }));
                    });

                } catch (error) {
                    activeDownloads--;
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: error.message
                    }));
                }
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Too many downloads in progress. Please wait.'
                }));
            }
        }
    });
});

const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
    });
});

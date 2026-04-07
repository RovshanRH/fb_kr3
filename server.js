const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const socketIo = require('socket.io');
const webpush = require('web-push');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
let server;
let protocol = 'http';

function getCertPair() {
    const pairs = [
        ['localhost+2.pem', 'localhost+2-key.pem'],
        ['localhost.pem', 'localhost-key.pem']
    ];

    for (const [cert, key] of pairs) {
        const certPath = path.join(__dirname, cert);
        const keyPath = path.join(__dirname, key);

        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            return { certPath, keyPath };
        }
    }

    return null;
}

const certPair = getCertPair();
if (certPair) {
    protocol = 'https';
    server = https.createServer(
        {
            cert: fs.readFileSync(certPair.certPath),
            key: fs.readFileSync(certPair.keyPath)
        },
        app
    );
} else {
    server = http.createServer(app);
}

const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const VAPID_PUBLIC_KEY = 'BHxnqUVIW8YoTnQByv1d3IDN4DY3QxRjWAoMGvi7PAGKy9fREhKhnFPB2LQyZw7Jws0daGotxkEnKWtUxo-aUls';
const VAPID_PRIVATE_KEY = 'r6pudygCmFZ-wzBJK_44m1p1GypaJsapa1XTkfP3fXU';
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:example@example.com';

webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, './')));

app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
});

let subscriptions = [];

function sendPushToAll(payload) {
    const invalidEndpoints = new Set();

    const operations = subscriptions.map((subscription) =>
        webpush.sendNotification(subscription, JSON.stringify(payload)).catch((error) => {
            if (error.statusCode === 404 || error.statusCode === 410) {
                invalidEndpoints.add(subscription.endpoint);
            }
            console.error('Push error:', error.message);
        })
    );

    return Promise.all(operations).then(() => {
        if (!invalidEndpoints.size) {
            return;
        }

        subscriptions = subscriptions.filter((sub) => !invalidEndpoints.has(sub.endpoint));
    });
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('newTask', async (task) => {
        io.emit('taskAdded', task);

        await sendPushToAll({
            title: 'Новая заметка',
            body: task.text
        });
    });

    socket.on('noteUpdated', async (task) => {
        io.emit('taskUpdated', task);

        await sendPushToAll({
            title: 'Заметка изменена',
            body: task.text || 'Текст заметки обновлен'
        });
    });

    socket.on('noteDeleted', async (task) => {
        io.emit('taskDeleted', task);

        await sendPushToAll({
            title: 'Заметка удалена',
            body: `ID: ${task.id}`
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

app.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/subscribe', (req, res) => {
    const subscription = req.body;

    if (!subscription?.endpoint) {
        res.status(400).json({ message: 'Invalid subscription object' });
        return;
    }

    const exists = subscriptions.some((sub) => sub.endpoint === subscription.endpoint);

    if (!exists) {
        subscriptions.push(subscription);
    }

    res.status(201).json({ message: 'Subscription saved' });
});

app.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body || {};

    subscriptions = subscriptions.filter((sub) => sub.endpoint !== endpoint);
    res.status(200).json({ message: 'Subscription removed' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server started on ${protocol}://localhost:${PORT}`);
    console.log('VAPID public key:', VAPID_PUBLIC_KEY);
    if (!certPair) {
        console.log('HTTPS сертификаты не найдены. Для HTTPS выполните: npm run certificate');
    }
});

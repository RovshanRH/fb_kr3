const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const swPath = path.join(projectRoot, 'sw.js');

const rootFiles = ['index.html', 'app.js', 'manifest.json'];
const scanDirs = ['content', 'scripts', 'styles', 'icons'];
const allowedExtensions = new Set([
    '.html',
    '.js',
    '.css',
    '.json',
    '.png',
    '.ico',
    '.svg',
    '.webp',
    '.jpg',
    '.jpeg',
    '.gif',
    '.txt',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf'
]);

function toPosix(relativePath) {
    return relativePath.split(path.sep).join('/');
}

function fileExists(relativePath) {
    return fs.existsSync(path.join(projectRoot, relativePath));
}

function collectFilesFromDir(relativeDir) {
    const absoluteDir = path.join(projectRoot, relativeDir);

    if (!fs.existsSync(absoluteDir)) {
        return [];
    }

    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const relativeEntryPath = path.join(relativeDir, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectFilesFromDir(relativeEntryPath));
            continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(ext)) {
            continue;
        }

        if (entry.name === 'sw.js' || entry.name === 'generate-sw.js') {
            continue;
        }

        files.push(toPosix(relativeEntryPath));
    }

    return files;
}

function getStaticAssets() {
    const fromRoot = rootFiles.filter(fileExists).map(toPosix);
    const fromDirs = scanDirs.flatMap(collectFilesFromDir);

    const unique = Array.from(new Set(['', ...fromRoot, ...fromDirs]));

    return unique
        .map((file) => (file ? `./${file}` : './'))
        .sort((a, b) => {
            if (a === './') return -1;
            if (b === './') return 1;
            return a.localeCompare(b);
        });
}

function buildServiceWorker(assets) {
    const cacheVersion = crypto
        .createHash('sha1')
        .update(assets.join('\n'))
        .digest('hex')
        .slice(0, 8);

    const staticCacheName = `notes-static-${cacheVersion}`;
    const dynamicCacheName = `notes-dynamic-${cacheVersion}`;
    const assetsArray = JSON.stringify(assets, null, 2);

    return `const STATIC_CACHE_NAME = '${staticCacheName}';\nconst DYNAMIC_CACHE_NAME = '${dynamicCacheName}';\n\nconst STATIC_ASSETS = ${assetsArray};\n\nself.addEventListener('install', (event) => {\n  event.waitUntil(\n    caches.open(STATIC_CACHE_NAME)\n      .then((cache) => cache.addAll(STATIC_ASSETS))\n      .then(() => self.skipWaiting())\n  );\n});\n\nself.addEventListener('activate', (event) => {\n  event.waitUntil(\n    caches.keys().then((keys) => Promise.all(\n      keys\n        .filter((key) => key !== STATIC_CACHE_NAME && key !== DYNAMIC_CACHE_NAME)\n        .map((key) => caches.delete(key))\n    )).then(() => self.clients.claim())\n  );\n});\n\nself.addEventListener('fetch', (event) => {\n  const { request } = event;\n  const url = new URL(request.url);\n\n  if (request.method !== 'GET') {\n    return;\n  }\n\n  if (url.origin !== self.location.origin) {\n    return;\n  }\n\n  if (url.pathname.startsWith('/content/')) {\n    event.respondWith(\n      fetch(request)\n        .then((networkRes) => {\n          const resClone = networkRes.clone();\n          caches.open(DYNAMIC_CACHE_NAME).then((cache) => cache.put(request, resClone));\n          return networkRes;\n        })\n        .catch(() => caches.match(request)\n          .then((cached) => cached || caches.match('./content/home.html')))\n    );\n    return;\n  }\n\n  event.respondWith(\n    caches.match(request).then((cached) => {\n      if (cached) {\n        return cached;\n      }\n\n      return fetch(request).then((networkRes) => {\n        const copy = networkRes.clone();\n        caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, copy));\n        return networkRes;\n      });\n    })\n  );\n});\n\nself.addEventListener('push', (event) => {\n  let payload = {};\n\n  try {\n    payload = event.data ? event.data.json() : {};\n  } catch {\n    payload = { body: event.data?.text() || 'New notification' };\n  }\n\n  const title = payload.title || 'Notification';\n  const options = {\n    body: payload.body || 'You have a new message',\n    icon: './icons/android-chrome-192x192.png',\n    badge: './icons/favicon-32x32.png'\n  };\n\n  event.waitUntil(self.registration.showNotification(title, options));\n});\n`;
}

function generate() {
    const assets = getStaticAssets();
    const swContent = buildServiceWorker(assets);

    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`Generated sw.js with ${assets.length} static assets.`);
}

generate();

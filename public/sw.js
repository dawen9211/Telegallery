const CACHE_NAME = 'telegallery-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const streams = new Map();
const progressChannel = new BroadcastChannel('tele_buffer');

self.addEventListener('message', (event) => {
  if (event.data.type === 'REGISTER_STREAM') {
    streams.set(event.data.url, event.data.port);
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname.startsWith('/stream-media/')) {
    const streamUrl = url.pathname;
    const port = streams.get(streamUrl);
    
    if (!port) {
      event.respondWith(new Response('Stream not found', { status: 404 }));
      return;
    }

    const rangeHeader = event.request.headers.get('Range');
    
    event.respondWith(new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      
      let streamController;
      let headersSent = false;
      let downloadedBytes = 0;
      let totalBytes = 0;

      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
        pull(controller) {
          messageChannel.port1.postMessage({ type: 'PULL' });
        },
        cancel() {
          messageChannel.port1.postMessage({ type: 'CANCEL' });
        }
      }, {
        highWaterMark: 1024 * 1024, // 1MB buffer for smoothness
        size(chunk) {
          return chunk.byteLength || 1;
        }
      });

      messageChannel.port1.onmessage = (e) => {
        if (e.data.type === 'HEADERS') {
          headersSent = true;
          totalBytes = e.data.total;
          const headers = {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(e.data.contentLength),
            'Content-Type': e.data.contentType || 'video/mp4',
            'Cache-Control': 'no-cache'
          };
          
          if (e.data.isRange) {
            headers['Content-Range'] = `bytes ${e.data.start}-${e.data.end}/${e.data.total}`;
          }
          
          resolve(new Response(stream, {
            status: 206,
            statusText: 'Partial Content',
            headers
          }));
        } else if (e.data.type === 'CHUNK') {
          const chunk = new Uint8Array(e.data.chunk);
          downloadedBytes += chunk.byteLength;
          
          // Send progress to UI
          if (totalBytes > 0) {
            progressChannel.postMessage({
              url: streamUrl,
              downloaded: downloadedBytes,
              total: totalBytes,
              percent: (downloadedBytes / totalBytes) * 100
            });
          }

          streamController.enqueue(chunk);
        } else if (e.data.type === 'DONE') {
          streamController.close();
        } else if (e.data.type === 'ERROR') {
          streamController.error(new Error('Stream error'));
          if (!headersSent) {
            resolve(new Response('Error', { status: 500 }));
          }
        }
      };
      
      port.postMessage({
        type: 'REQUEST_STREAM',
        range: rangeHeader,
        port: messageChannel.port2
      }, [messageChannel.port2]);
    }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

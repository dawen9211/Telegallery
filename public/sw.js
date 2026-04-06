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
const streamStrategies = new Map();

self.addEventListener('message', (event) => {
  if (event.data.type === 'REGISTER_STREAM') {
    streams.set(event.data.url, event.data.port);
  } else if (event.data.type === 'CANCEL_STREAM') {
    const port = streams.get(event.data.url);
    if (port) {
      port.postMessage({ type: 'CANCEL' });
      streams.delete(event.data.url);
      streamStrategies.delete(event.data.url);
    }
  } else if (event.data.type === 'UPDATE_STREAM_STRATEGY') {
    streamStrategies.set(event.data.url, event.data);
    const port = streams.get(event.data.url);
    if (port) {
      port.postMessage({ type: 'UPDATE_STRATEGY', strategy: event.data });
    }
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
        highWaterMark: 5 * 1024 * 1024, // 5MB buffer
        size(chunk) {
          return chunk.byteLength || 1;
        }
      });

      messageChannel.port1.onmessage = (e) => {
        if (e.data.type === 'HEADERS') {
          headersSent = true;
          const headers = {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(e.data.contentLength),
            'Content-Type': e.data.contentType || 'video/mp4'
          };
          
          if (e.data.isRange) {
            // Ensure values are strictly numbers/strings, not objects
            const start = String(e.data.start).replace(/\[object Object\]/g, '0');
            const end = String(e.data.end).replace(/\[object Object\]/g, '0');
            const total = String(e.data.total).replace(/\[object Object\]/g, '0');
            headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
          }
          
          resolve(new Response(stream, {
            status: e.data.isRange ? 206 : 200,
            headers
          }));
        } else if (e.data.type === 'CHUNK') {
          streamController.enqueue(new Uint8Array(e.data.chunk));
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

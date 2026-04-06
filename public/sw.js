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
    streams.set(event.data.url, { port: event.data.port, totalSize: event.data.totalSize, fileId: event.data.fileId, downloadedBytes: 0, headersSent: false, pendingRequest: null });
  } else if (event.data.type === 'CANCEL_STREAM') {
    const stream = streams.get(event.data.url);
    if (stream) {
      stream.port.postMessage({ type: 'CANCEL' });
      streams.delete(event.data.url);
      streamStrategies.delete(event.data.url);
    }
  } else if (event.data.type === 'UPDATE_STREAM_STRATEGY') {
    streamStrategies.set(event.data.url, event.data);
    const stream = streams.get(event.data.url);
    if (stream) {
      stream.port.postMessage({ type: 'UPDATE_STRATEGY', strategy: event.data });
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  console.log('Fetch request:', url.pathname);
  
  if (url.pathname.startsWith('/stream-media/')) {
    const streamUrl = url.pathname;
    const stream = streams.get(streamUrl);
    
    if (!stream) {
      event.respondWith(new Response('Stream not found', { status: 404 }));
      return;
    }

    const { port, totalSize } = stream;
    const rangeHeader = event.request.headers.get('Range');
    
    const promise = new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      
      let streamController;
      const streamReadable = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
        pull(controller) {
          messageChannel.port1.postMessage({ type: 'PULL' });
        },
        cancel() {
          messageChannel.port1.postMessage({ type: 'CANCEL' });
        }
      });

      messageChannel.port1.onmessage = (e) => {
        if (e.data.type === 'HEADERS') {
          stream.headers = e.data;
          stream.headersSent = true;
          stream.resolved = true;
          resolve(createResponse(streamReadable, stream.headers, e.data.isRange || !!rangeHeader));
        } else if (e.data.type === 'CHUNK') {
          stream.downloadedBytes += e.data.chunk.byteLength;
          streamController.enqueue(new Uint8Array(e.data.chunk));
          
          const progress = (stream.downloadedBytes / totalSize) * 100;
          
          // Send progress via BroadcastChannel 'tele_buffer'
          // Only send every ~512KB to avoid flooding
          if (!stream.lastProgressUpdate || stream.downloadedBytes - stream.lastProgressUpdate >= 512 * 1024 || progress >= 100) {
            const channel = new BroadcastChannel('tele_buffer');
            channel.postMessage({ type: 'PROGRESS', fileId: stream.fileId, progress });
            channel.close();
            stream.lastProgressUpdate = stream.downloadedBytes;
          }
        } else if (e.data.type === 'DONE') {
          if (!stream.resolved && stream.headersSent) {
             stream.resolved = true;
             resolve(createResponse(streamReadable, stream.headers, stream.headers.isRange || !!rangeHeader));
          }
          streamController.close();
        } else if (e.data.type === 'ERROR') {
          streamController.error(new Error('Stream error'));
          if (!stream.headersSent) {
            resolve(new Response('Error', { status: 500 }));
          }
        }
      };
      
      port.postMessage({
        type: 'REQUEST_STREAM',
        range: rangeHeader,
        port: messageChannel.port2
      }, [messageChannel.port2]);
    });

    event.respondWith(promise);
    event.waitUntil(promise);
    return;
  }
});

function createResponse(stream, headersData, isRange) {
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(headersData.contentLength),
    'Content-Type': headersData.contentType || 'video/mp4',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  };
  
  if (isRange) {
    const start = String(headersData.start || 0);
    const end = String(headersData.end || (headersData.total - 1));
    const total = String(headersData.total || '*');
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  
  return new Response(stream, {
    status: isRange ? 206 : 200,
    statusText: isRange ? 'Partial Content' : 'OK',
    headers
  });
}

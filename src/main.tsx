import { Buffer } from 'buffer';
import './polyfills';

if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
  (window as any).globalThis.Buffer = Buffer;
  if (!(window as any).process) {
    (window as any).process = { env: {}, browser: true, version: '', nextTick: (cb: any) => setTimeout(cb, 0) };
  } else {
    (window as any).process.browser = true;
  }
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration failed: ', err));
  });
}

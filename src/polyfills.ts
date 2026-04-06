import { Buffer } from 'buffer';
import * as util from 'util';
(window as any).Buffer = Buffer;
(window as any).global = window;
(window as any).process = { 
  env: { NODE_ENV: 'development' },
  nextTick: (cb: any) => setTimeout(cb, 0),
  browser: true
};
(window as any).Api = {};
(window as any).util = util;
const osPolyfill = {
  type: () => 'browser',
  platform: () => 'browser',
  release: () => '1.0.0',
  arch: () => 'x64',
  endianness: () => 'LE',
  homedir: () => '/',
  tmpdir: () => '/tmp',
  hostname: () => 'localhost',
  loadavg: () => [0, 0, 0],
  uptime: () => 0,
  freemem: () => 1024 * 1024 * 1024,
  totalmem: () => 1024 * 1024 * 1024,
  cpus: () => [],
  networkInterfaces: () => ({}),
};
(osPolyfill as any).default = osPolyfill;
(window as any).os = osPolyfill;
if (!(window as any).util.inspect) {
  (window as any).util.inspect = {
    custom: Symbol.for('nodejs.util.inspect.custom')
  };
}

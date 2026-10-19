// Copies the barcode decoder (WebAssembly) into public/, so the web app serves
// it itself instead of fetching it from a CDN at scan time. Runs after install.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const source = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
const target = join(import.meta.dirname, '..', 'public', 'zxing', 'zxing_reader.wasm');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log('Copied the barcode decoder to public/zxing/');

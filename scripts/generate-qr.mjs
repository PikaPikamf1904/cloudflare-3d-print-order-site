import { resolve } from 'node:path';

const url = process.argv[2];
if (!url || !/^https:\/\/(?!YOUR-|example\.com)/i.test(url)) {
  throw new Error('Pass the confirmed HTTPS customer URL, for example: node scripts/generate-qr.mjs https://your-worker.workers.dev/');
}
let QRCode;
try { QRCode = await import('qrcode'); } catch { throw new Error('Install the local QR dependency first: npm install --save-dev qrcode'); }
await QRCode.toFile(resolve('customer-qr.png'), url, { type: 'png', width: 768, margin: 2 });
await QRCode.toFile(resolve('customer-qr.svg'), url, { type: 'svg', margin: 2 });
console.log('Created customer-qr.png and customer-qr.svg for the public customer URL.');

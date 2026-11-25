'use strict';
// Renders the logo SVG from src/renderer/icons.js into build/icon.png and a multi-size build/icon.ico.
//   npx electron scripts/make-icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'src', 'renderer', 'icons.js'), 'utf8'), sandbox);
const svg = sandbox.window.ICONS.logo;

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...pngs.map(p => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const SIZE = 512;
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(root, 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(sizes.map(size => ({ size, data: img.resize({ width: size, height: size, quality: 'best' }).toPNG() }))));
  console.log('wrote build/icon.png and build/icon.ico');
  app.quit();
});

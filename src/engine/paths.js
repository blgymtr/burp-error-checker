'use strict';
// Turns absolute paths into short, privacy-friendly ones for display and reports,
// e.g. C:\Users\name\AppData\Roaming\BurpSuite\bapps -> %APPDATA%\BurpSuite\bapps

const fs = require('fs');
const os = require('os');
const path = require('path');

function longPath(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

function defaultAliases(env = process.env) {
  const list = [];
  const add = (dir, label) => {
    if (!dir) return;
    list.push({ prefix: dir, label });
    const lp = longPath(dir);
    if (lp && lp !== dir) list.push({ prefix: lp, label });
  };
  if (process.platform === 'win32') {
    add(env.TEMP || env.TMP, '%TEMP%');
    add(env.LOCALAPPDATA, '%LOCALAPPDATA%');
    add(env.APPDATA, '%APPDATA%');
    add(env.USERPROFILE, '%USERPROFILE%');
  } else {
    add(os.tmpdir(), '$TMPDIR');
    add(os.homedir(), '~');
  }
  return list;
}

function makeDisplay(extraAliases = []) {
  const aliases = [...extraAliases, ...defaultAliases()]
    .filter(a => a.prefix)
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const ci = process.platform === 'win32';
  return function display(p) {
    if (!p || typeof p !== 'string') return p;
    for (const a of aliases) {
      const pre = a.prefix.replace(/[\\/]+$/, '');
      const head = p.slice(0, pre.length);
      const same = ci ? head.toLowerCase() === pre.toLowerCase() : head === pre;
      if (same && (p.length === pre.length || p[pre.length] === '\\' || p[pre.length] === '/')) {
        return a.label + p.slice(pre.length);
      }
    }
    return p;
  };
}

// Replaces every alias occurrence inside free text (error messages etc).
function scrubText(text, display, knownPaths) {
  if (!text) return text;
  let out = String(text);
  for (const p of knownPaths) {
    if (!p) continue;
    const d = display(p);
    if (d !== p) out = out.split(p).join(d);
  }
  return out;
}

module.exports = { makeDisplay, scrubText, longPath, path };

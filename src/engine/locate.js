'use strict';
// Finds Burp's config file, Burp's install folder, its bundled Java runtime,
// and a Java executable the checker itself can use to run Jython.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function burpConfigDir(env = process.env) {
  if (IS_WIN) return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BurpSuite');
  return path.join(os.homedir(), '.BurpSuite');
}

const CONFIG_NAMES = ['UserConfig.json', 'UserConfigPro.json', 'UserConfigCommunity.json'];

// Returns every user-config file found, newest first.
function findConfigFiles(dir) {
  const out = [];
  for (const n of CONFIG_NAMES) {
    const p = path.join(dir, n);
    if (isFile(p)) out.push({ path: p, mtime: fs.statSync(p).mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime).map(x => x.path);
}

function burpInstallCandidates(env = process.env) {
  const c = [];
  if (IS_WIN) {
    const la = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean);
    for (const n of ['BurpSuite', 'BurpSuitePro', 'BurpSuiteCommunity']) c.push(path.join(la, 'Programs', n));
    for (const base of pf) for (const n of ['BurpSuitePro', 'BurpSuiteCommunity', 'BurpSuite']) c.push(path.join(base, n));
  } else if (process.platform === 'darwin') {
    for (const n of ['Burp Suite Professional.app', 'Burp Suite Community Edition.app', 'Burp Suite.app']) {
      c.push(path.join('/Applications', n, 'Contents', 'Resources', 'app'));
      c.push(path.join('/Applications', n, 'Contents', 'Resources'));
    }
  } else {
    for (const n of ['BurpSuitePro', 'BurpSuiteCommunity', 'BurpSuite']) {
      c.push(path.join(os.homedir(), n));
      c.push(path.join('/opt', n));
    }
  }
  return [...new Set(c)];
}

function jreRelease(dir) {
  for (const rel of [['jre', 'release'], ['jre', 'Contents', 'Home', 'release'], ['..', 'jre.bundle', 'Contents', 'Home', 'release']]) {
    const p = path.join(dir, ...rel);
    if (isFile(p)) {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/JAVA_VERSION="([^"]+)"/);
      if (m) return { file: p, version: m[1], major: javaMajor(m[1]), home: path.dirname(p) };
    }
  }
  return null;
}

function javaMajor(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^1\.(\d+)/) || s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function findBurpInstall(override, env = process.env) {
  const list = override ? [override] : burpInstallCandidates(env);
  for (const dir of list) {
    if (!isDir(dir)) continue;
    const hasJar = isFile(path.join(dir, 'burpsuite.jar')) || isFile(path.join(dir, 'burpsuite_pro.jar')) || isFile(path.join(dir, 'burpsuite_community.jar'));
    const hasExe = isFile(path.join(dir, 'BurpSuite' + EXE)) || isFile(path.join(dir, 'BurpSuitePro' + EXE)) || isFile(path.join(dir, 'BurpSuiteCommunity' + EXE));
    const jre = jreRelease(dir);
    if (hasJar || hasExe || jre) return { dir, jre };
  }
  return null;
}

function javaVersionOf(javaExe) {
  try {
    const r = spawnSync(javaExe, ['-version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    if (r.error) return null;
    const txt = (r.stderr || '') + (r.stdout || '');
    const m = txt.match(/version "([^"]+)"/);
    return m ? { version: m[1], major: javaMajor(m[1]) } : null;
  } catch { return null; }
}

// Java used by the checker to run the Jython syntax check.
function findJava(override, burpInstall, env = process.env) {
  const tried = [];
  const candidates = [];
  if (override) candidates.push({ path: override, source: 'settings' });
  if (burpInstall && burpInstall.jre) {
    candidates.push({ path: path.join(burpInstall.jre.home, 'bin', 'java' + EXE), source: "Burp's bundled runtime" });
  }
  if (env.JAVA_HOME) candidates.push({ path: path.join(env.JAVA_HOME, 'bin', 'java' + EXE), source: 'JAVA_HOME' });
  for (const c of candidates) {
    tried.push(c.path);
    if (isFile(c.path)) {
      const v = javaVersionOf(c.path);
      if (v) return { path: c.path, source: c.source, ...v };
    }
  }
  const onPath = javaVersionOf('java');
  if (onPath) return { path: 'java', source: 'PATH', ...onPath };
  return { path: null, tried };
}

// Windows 8.3 short name of an existing folder (ASCII-only when 8.3 names are enabled).
function shortPath(p) {
  if (!IS_WIN || !isDir(p)) return null;
  try {
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', 'for %I in ("' + p + '") do @echo %~sI'], { encoding: 'utf8', timeout: 10000, windowsHide: true, windowsVerbatimArguments: true });
    const out = (r.stdout || '').split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean).pop();
    const printable = out && [...out].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127);
    return printable && out !== p ? out : null;
  } catch { return null; }
}

module.exports = {
  shortPath,
  burpConfigDir, findConfigFiles, findBurpInstall, findJava, javaMajor, jreRelease,
  exists, isFile, isDir, IS_WIN,
};

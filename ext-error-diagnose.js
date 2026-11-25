'use strict';
// ext-error-diagnose.js -- Burp Suite'te yuklu olmayan extensionlar icin kok neden teshisi.
//   node ext-error-diagnose.js
// Testler: dosya varligi, Jython compile (syntax-only), jar gecerliligi, config yolu dogrulama.
// PURE LOCAL: hedef trafik YOK. Jython yalnizca COMPILE modunda calisir (kod calistirmaz).
// Windows-first (Jython standalon jar gerektirir; BURP_JYTHON ile yol gecilebilir).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APPDATA = process.env.APPDATA || '';
const BAPPS = path.join(APPDATA, 'BurpSuite', 'bapps');
const JYTHON = process.env.BURP_JYTHON || path.join(process.cwd(), 'jython-standalone-2.7.4.jar');
const OUT = process.env.DIAGNOSE_OUT || 'ext-error-report.md';
const report = [];

function absPath(rel) {
  if (!rel) return null;
  const norm = rel.replace(/^bapps\\/i, '').replace(/\//g, path.sep);
  return path.join(BAPPS, norm);
}

function checkFile(rel) {
  const abs = absPath(rel);
  if (!abs) return { fileOk: false, note: 'dosya yolu configde yok' };
  const ok = fs.existsSync(abs);
  return { fileOk: ok, note: ok ? path.basename(abs) + ' (' + Math.round(fs.statSync(abs).size / 1024) + ' KB)' : 'DOSYA YOK: ' + rel };
}

function jythonCompile(abs) {
  // syntax-only compile, dosya-ustinden: ENAMETOOLONG yasa
  const tmp = path.join(require('os').tmpdir(), 'jy-compile-' + Date.now() + '.py');
  fs.writeFileSync(tmp, `import sys\nsrc=open(sys.argv[1],"rb").read()\ncompile(src, sys.argv[1], "exec")\nprint("COMPILE_OK")\n`);
  try {
    const out = execFileSync('java', ['-jar', JYTHON, tmp, abs], { encoding: 'utf8', timeout: 120000 });
    return { pyOk: out.includes('COMPILE_OK'), note: out.includes('COMPILE_OK') ? 'Jython compile OK' : 'beklenmeyen cikti: ' + out.slice(0, 200) };
  } catch (e) {
    const m = String((e.stderr || '') + ' ' + (e.stdout || '') + ' ' + (e.message || ''));
    return { pyOk: false, note: 'Jython COMPILE HATA: ' + m.slice(0, 400) };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { }
  }
}

function jarCheck(abs) {
  try {
    execFileSync('jar', ['tf', abs], { encoding: 'utf8', timeout: 60000 });
    return { jarOk: true, note: 'jar gecerli' };
  } catch (e) {
    // fall back to tar if the jar tool is missing
    try {
      execFileSync('tar', ['-tf', abs], { encoding: 'utf8', timeout: 60000 });
      return { jarOk: true, note: 'jar gecerli (tar tf)' };
    } catch (e2) {
      return { jarOk: false, note: 'JAR BOZUK/YOK: ' + String(e.stderr || e.message).slice(0, 200) };
    }
  }
}

(async function main() {
  // MCP kanali varsa canli config oku; yoksa diskteki UserConfig.json'dan oku (Burp kapali mod)
  let ext = [];
  let py = {};
  try {
    const bridge = require(path.join(process.cwd(), 'burp_bridge_shim.js'));
    const r = bridge.mcpCall('output_user_options', {});
    const o = JSON.parse(r.json.result.content.map(c => c.text).join('')).user_options;
    ext = o.extender.extensions || [];
    py = o.extender.python || {};
  } catch {
    try {
      const uc = JSON.parse(fs.readFileSync(path.join(APPDATA, 'BurpSuite', 'UserConfig.json'), 'utf8'));
      ext = ((uc.user_options || {}).extender || {}).extensions || [];
      py = ((uc.user_options || {}).extender || {}).python || {};
    } catch (e2) {
      report.push('config okunamadi: ' + String(e2).slice(0, 120));
    }
  }
  report.push('Python env (config): ' + JSON.stringify(py).slice(0, 160));
  const failing = ext.filter(e => !e.loaded);
  report.push('Yuklu olmayan: ' + failing.length + '\n');

  for (const e of failing) {
    const line = [`== ${e.name} (tip: ${e.extension_type})`];
    const c = checkFile(e.extension_file);
    line.push('  dosya: ' + c.note);
    if (e.extension_type === 'python' && c.fileOk) {
      const t = jythonCompile(absPath(e.extension_file));
      line.push('  jython: ' + t.note);
    } else if (e.extension_type === 'python') {
      line.push('  jython: test edilemedi (dosya yok)');
    }
    if (e.extension_type === 'java' && c.fileOk) {
      const t = jarCheck(absPath(e.extension_file));
      line.push('  jar: ' + t.note);
    }
    report.push(...line);
  }

  const md = ['# Extension error teshisi - ' + new Date().toISOString(), '', ...report];
  fs.writeFileSync(OUT, md.join('\n'));
  console.log(md.join('\n'));
  console.log('\nrapor: ' + OUT);
})();


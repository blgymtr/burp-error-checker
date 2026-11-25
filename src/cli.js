#!/usr/bin/env node
'use strict';
// Command-line version of Burp Error Checker.
//   node src/cli.js [--all] [--config FILE] [--jython JAR] [--java EXE] [--burp DIR] [--out FILE] [--format md|html|json]

const fs = require('fs');
const path = require('path');
const { diagnose } = require('./engine/diagnose');
const report = require('./engine/report');
const pkg = require('../package.json');

function parseArgs(argv) {
  const o = { format: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--all') o.includeLoaded = true;
    else if (a === '--config') o.configPath = next();
    else if (a === '--jython') o.jythonPath = next();
    else if (a === '--java') o.javaPath = next();
    else if (a === '--burp') o.burpDir = next();
    else if (a === '--out') o.out = next();
    else if (a === '--format') o.format = next();
    else if (a === '--no-jython') o.skipJython = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else { console.error('Unknown option: ' + a); o.help = true; o.bad = true; }
  }
  return o;
}

const HELP = `Burp Error Checker ${pkg.version}
Finds out why Burp Suite extensions do not load. Read-only: nothing is changed.

Usage: burp-error-checker [options]

  --all              also analyze extensions that are currently loaded
  --config FILE      Burp user settings file (default: auto-detect UserConfig.json)
  --jython JAR       Jython standalone JAR (default: the one set in Burp)
  --java EXE         java executable used to run Jython (default: Burp's bundled Java)
  --burp DIR         Burp install folder (default: auto-detect)
  --no-jython        skip the Jython compile step (faster, less precise)
  --out FILE         write a report (.md, .html or .json, picked from the extension)
  --format FMT       print md, html or json to stdout instead of the summary
  --demo             run against a built-in example with typical broken extensions
  --quiet            no progress output
  -h, --help         show this help
  -v, --version      show the version

Exit code: 0 = no errors found, 1 = at least one extension has an error, 2 = could not run.
`;

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[36m', d: '\x1b[2m', B: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', y: '', g: '', b: '', d: '', B: '', x: '' };
const SEV = { error: C.r + '✖' + C.x, warning: C.y + '▲' + C.x, info: C.b + 'ℹ' + C.x, ok: C.g + '✔' + C.x, unknown: C.d + '?' + C.x, loaded: C.g + '✔' + C.x };

(async () => {
  const o = parseArgs(process.argv.slice(2));
  if (o.version) { console.log(pkg.version); return; }
  if (o.help) { console.log(HELP); process.exitCode = o.bad ? 2 : 0; return; }
  let last = -1;
  const demo = o.demo ? require('./demo').demoOptions() : {};
  const r = await diagnose({
    ...o,
    ...demo,
    appVersion: pkg.version,
    onProgress: ({ pct, message }) => {
      if (o.quiet || o.format || pct === last) return;
      last = pct;
      process.stderr.write(C.d + `[${String(pct).padStart(3)}%] ${message}` + C.x + '\n');
    },
  });

  if (o.out) {
    const ext = path.extname(o.out).toLowerCase();
    const body = ext === '.html' || ext === '.htm' ? report.toHTML(r) : ext === '.json' ? report.toJSON(r) : report.toMarkdown(r);
    fs.writeFileSync(o.out, body);
  }

  if (o.format) {
    const f = o.format.toLowerCase();
    process.stdout.write(f === 'json' ? report.toJSON(r) : f === 'html' ? report.toHTML(r) : report.toMarkdown(r));
  } else {
    console.log('');
    console.log(C.B + 'Environment' + C.x);
    for (const e of r.environment) console.log(`  ${SEV[e.status]} ${e.label}: ${e.value}` + (e.status !== 'ok' ? C.d + '\n      ' + e.detail + C.x : ''));
    console.log('');
    const s = r.summary;
    console.log(C.B + `Extensions: ${s.total} total, ${s.loaded} loaded, ${s.notLoaded} not loaded` + C.x);
    for (const e of r.extensions.filter(x => x.analyzed)) {
      console.log(`  ${SEV[e.status]} ${C.B}${e.name}${C.x} ${C.d}(${e.typeLabel})${C.x}`);
      for (const f of e.findings) {
        console.log(`      ${SEV[f.severity]} ${f.title}`);
        if (f.evidence) console.log(C.d + `        ${f.evidence.file}${f.evidence.line ? ':' + f.evidence.line : ''}  ${f.evidence.message}` + C.x);
        if (f.modules) console.log(C.d + '        modules: ' + f.modules.map(m => m.module).join(', ') + C.x);
      }
    }
    console.log('');
    console.log(`${C.r}${s.errors} error${C.x} · ${C.y}${s.warnings} warning${C.x} · ${s.unknown} with no static cause` + (o.out ? ` · report: ${o.out}` : ''));
  }
  process.exitCode = r.summary.errors > 0 ? 1 : 0;
})().catch((e) => {
  console.error('Burp Error Checker failed: ' + (e && e.stack || e));
  process.exitCode = 2;
});

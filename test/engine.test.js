'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openZip } = require('../src/engine/zip');
const py = require('../src/engine/python');
const { diagnose } = require('../src/engine/diagnose');
const report = require('../src/engine/report');
const { buildDemo, makeZip } = require('../src/demo');

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bec-test-')), name);

test('zip reader lists and reads entries', () => {
  const f = tmp('a.jar');
  fs.writeFileSync(f, makeZip({ 'a.txt': 'hello', 'dir/b.class': Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61]) }));
  const z = openZip(f);
  try {
    assert.deepStrictEqual(z.entries.map(e => e.name), ['a.txt', 'dir/b.class']);
    assert.strictEqual(z.read(z.entries[0]).toString(), 'hello');
    assert.strictEqual(z.read(z.entries[1]).readUInt16BE(6), 61);
  } finally { z.close(); }
});

test('zip reader rejects truncated archives', () => {
  const f = tmp('broken.jar');
  const full = makeZip({ 'a.txt': 'x'.repeat(5000) });
  fs.writeFileSync(f, full.subarray(0, full.length - 30));
  assert.throws(() => openZip(f));
});

test('import scan finds modules and marks fallbacks optional', () => {
  const src = [
    'import os, sys as system',
    'from java.util import ArrayList',
    'from . import sibling',
    'try:',
    '    import json',
    'except ImportError:',
    '    import simplejson as json',
    'def f():',
    '    import requests',
  ].join('\n');
  const imps = py.extractImports(src);
  const by = Object.fromEntries(imps.map(i => [i.module, i]));
  assert.ok(by.os && by.sys && by['java.util'] && by.json && by.simplejson && by.requests);
  assert.strictEqual(by.json.optional, true);
  assert.strictEqual(by.simplejson.optional, true);
  assert.strictEqual(by.requests.optional, false);
  assert.ok(!imps.some(i => i.module === 'sibling'));
});

test('python 3 hints spot f-strings and annotations', () => {
  const hints = py.python3Hints('x = 1\nprint(f"v={x}")\ndef g(a) -> int:\n    return a\n');
  assert.ok(hints.some(h => h.label.startsWith('f-string')));
  assert.ok(hints.some(h => h.label.includes('annotation')));
  assert.strictEqual(py.python3Hints('print "hello"\nx = "%s" % 1\n').length, 0);
});

function statusByName(r) {
  return Object.fromEntries(r.extensions.map(e => [e.name, e]));
}

test('demo: every broken extension gets the right diagnosis (no Jython)', async () => {
  const d = buildDemo({ root: tmp('demo'), jythonJar: null });
  const r = await diagnose({ configPath: d.configPath, burpDir: d.burpDir, aliases: d.aliases, skipJython: true });
  const by = statusByName(r);
  const codes = (n) => by[n].findings.map(f => f.code);

  assert.strictEqual(r.summary.total, 15);
  assert.strictEqual(r.summary.loaded, 6);
  assert.ok(codes('Token Inspector').includes('java-too-new'));
  assert.ok(codes('Param Scout').includes('missing-file'));
  assert.strictEqual(by['Param Scout'].findings[0].title, 'The saved path is out of date');
  assert.ok(codes('Request Journal').includes('jar-broken'));
  assert.ok(codes('GraphQL Scanner').includes('no-entry'));
  assert.ok(codes('Cookie Monitor').includes('missing-file'));
  assert.strictEqual(by['Response Highlighter'].status, 'unknown');
  // without a Jython JAR every Python extension reports it
  assert.ok(codes('Access Matrix').includes('jython'));
  assert.ok(codes('Access Matrix').includes('python3-guess'));
  // modules: requests + yaml missing, local package and stdlib resolved, simplejson optional
  const mm = by['Header Fuzzer'].findings.find(f => f.code === 'missing-module');
  assert.deepStrictEqual(mm.modules.map(m => m.module).sort(), ['requests', 'yaml']);
  assert.ok(by['Header Fuzzer'].findings.find(f => f.code === 'optional-module').modules.some(m => m.module === 'simplejson'));
  // loaded extensions are not analyzed by default
  assert.ok(r.extensions.filter(e => e.loaded).every(e => !e.analyzed && e.status === 'loaded'));
});

test('demo: loaded extensions pass every check when analyzed', async () => {
  const d = buildDemo({ root: tmp('demo2'), jythonJar: null });
  const r = await diagnose({ configPath: d.configPath, burpDir: d.burpDir, aliases: d.aliases, skipJython: true, includeLoaded: true });
  for (const e of r.extensions.filter(x => x.loaded)) {
    assert.strictEqual(e.status, 'loaded', e.name + ': ' + JSON.stringify(e.findings));
    assert.ok(e.checks.every(c => c.status === 'ok'), e.name);
  }
});

test('reports contain no absolute paths', async () => {
  const d = buildDemo({ root: tmp('demo3'), jythonJar: null });
  const r = await diagnose({ configPath: d.configPath, burpDir: d.burpDir, aliases: d.aliases, skipJython: true });
  for (const body of [report.toMarkdown(r), report.toHTML(r), report.toJSON(r)]) {
    assert.ok(!body.includes(d.root) && !body.includes(JSON.stringify(d.root).slice(1, -1)), 'report leaks the demo root path');
    assert.ok(!body.includes(os.homedir()), 'report leaks the home folder');
  }
  assert.ok(report.toMarkdown(r).includes('How to fix'));
});

test('missing config is reported, not thrown', async () => {
  const r = await diagnose({ configPath: tmp('nope') + path.sep + 'UserConfig.json', skipJython: true });
  assert.strictEqual(r.environment[0].status, 'error');
  assert.strictEqual(r.extensions.length, 0);
});

// Runs only when a Jython standalone JAR and Java are available (set BEC_JYTHON=path\to\jython-standalone.jar).
const JY = process.env.BEC_JYTHON;
test('real Jython compile finds Python 3 and syntax errors', { skip: !JY && 'set BEC_JYTHON to run' }, async () => {
  const d = buildDemo({ root: tmp('demo4'), jythonJar: JY });
  const r = await diagnose({ configPath: d.configPath, burpDir: d.burpDir, aliases: d.aliases });
  const by = statusByName(r);
  const am = by['Access Matrix'].findings.find(f => f.code === 'python3');
  assert.ok(am, JSON.stringify(by['Access Matrix'].findings));
  assert.strictEqual(am.evidence.line, 10);
  const sn = by['Scope Notifier'].findings.find(f => f.code === 'syntax');
  assert.ok(sn);
  assert.strictEqual(sn.evidence.line, 6);
  assert.strictEqual(by['Header Fuzzer'].findings.filter(f => f.code === 'syntax' || f.code === 'python3').length, 0);
});

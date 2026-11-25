'use strict';
// Builds a fake Burp Suite settings folder full of typical broken extensions.
// Used by "--demo" (try the app without Burp), by the tests and for the README screenshots.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------ tiny ZIP writer
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const locals = [];
  const cents = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0, 6); loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26); loc.writeUInt16LE(0, 28);
    locals.push(loc, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    cents.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(cents);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Fake class file: real header (magic + version) and the referenced type names in its body.
function fakeClass(javaVersion, refs = []) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(0xcafebabe, 0);
  head.writeUInt16BE(0, 4);
  head.writeUInt16BE(javaVersion + 44, 6);
  return Buffer.concat([head, Buffer.from('\u0000' + refs.join('\u0000') + '\u0000java/lang/Object\u0000')]);
}

const MONTOYA = 'burp/api/montoya/BurpExtension';
const LEGACY = 'burp/IBurpExtender';

function manifest(m) {
  return Object.entries(m).map(([k, v]) => k + ': ' + v).join('\n') + '\n';
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// ------------------------------------------------------------ the demo folder
function buildDemo({ root = path.join(os.tmpdir(), 'burp-error-checker-demo'), jythonJar = null, javaVersion = 21 } = {}) {
  fs.rmSync(root, { recursive: true, force: true });
  const roaming = path.join(root, 'AppData', 'Roaming');
  const local = path.join(root, 'AppData', 'Local');
  const burpDir = path.join(roaming, 'BurpSuite');
  const bapps = path.join(burpDir, 'bapps');
  const installDir = path.join(local, 'Programs', 'BurpSuite');
  writeFile(path.join(installDir, 'burpsuite.jar'), makeZip({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' }));
  writeFile(path.join(installDir, 'jre', 'release'), `JAVA_VERSION="${javaVersion}.0.5"\n`);

  let jythonPath = '';
  if (jythonJar && fs.existsSync(jythonJar)) {
    jythonPath = path.join(local, 'Jython', 'jython-standalone-2.7.4.jar');
    fs.mkdirSync(path.dirname(jythonPath), { recursive: true });
    try { fs.linkSync(jythonJar, jythonPath); } catch { fs.copyFileSync(jythonJar, jythonPath); }
  }
  const modulesDir = path.join(local, 'Jython', 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });
  writeFile(path.join(modulesDir, 'six.py'), '# placeholder for a pure-Python module\nPY2 = True\n');

  const exts = [];
  const bapp = (uuid, man, files) => {
    const dir = path.join(bapps, uuid);
    writeFile(path.join(dir, 'BappManifest.bmf'), manifest({ Uuid: uuid, ...man }));
    for (const [rel, content] of Object.entries(files || {})) writeFile(path.join(dir, rel), content);
    return dir;
  };
  const add = (e) => exts.push({ output: 'ui', errors: 'ui', auto_reload: false, use_ai: false, ...e });

  // 1. Python 3 code (f-strings) -> Jython syntax error
  bapp('5d1c0a9e4b7f4c2a8e3b6f0d9a1c7e42', { ExtensionType: 2, Name: 'Access Matrix', ScreenVersion: '1.4.0', Author: 'Demo Labs', ShortDescription: 'Compares responses for several user roles.', EntryPoint: 'access_matrix.py', ProOnly: 'False' }, {
    'access_matrix.py': [
      'from burp import IBurpExtender, ITab',
      'from javax.swing import JPanel',
      'import json',
      '',
      'class BurpExtender(IBurpExtender, ITab):',
      '    def registerExtenderCallbacks(self, callbacks):',
      '        self.callbacks = callbacks',
      '        callbacks.setExtensionName("Access Matrix")',
      '        roles = ["admin", "user", "guest"]',
      '        print(f"Loaded {len(roles)} roles")',
      '',
      '    def getTabCaption(self):',
      '        return "Access Matrix"',
      '',
    ].join('\n'),
  });
  add({ name: 'Access Matrix', extension_type: 'python', loaded: false, bapp_uuid: '5d1c0a9e4b7f4c2a8e3b6f0d9a1c7e42', bapp_serial_version: 7, extension_file: 'bapps\\5d1c0a9e4b7f4c2a8e3b6f0d9a1c7e42\\access_matrix.py' });

  // 2. Missing pip module
  const hdrDir = path.join(root, 'Extensions', 'header-fuzzer');
  writeFile(path.join(hdrDir, 'header_fuzzer.py'), [
    'from burp import IBurpExtender, IIntruderPayloadGeneratorFactory',
    'import requests',
    'import yaml',
    'from helpers.wordlist import load_words',
    'try:',
    '    import json',
    'except ImportError:',
    '    import simplejson as json',
    '',
    'class BurpExtender(IBurpExtender, IIntruderPayloadGeneratorFactory):',
    '    def registerExtenderCallbacks(self, callbacks):',
    '        callbacks.setExtensionName("Header Fuzzer")',
    '        self.words = load_words()',
    '',
  ].join('\n'));
  writeFile(path.join(hdrDir, 'helpers', '__init__.py'), '');
  writeFile(path.join(hdrDir, 'helpers', 'wordlist.py'), 'import os\n\ndef load_words():\n    return ["X-Forwarded-For", "X-Original-URL"]\n');
  add({ name: 'Header Fuzzer', extension_type: 'python', loaded: false, extension_file: path.join(hdrDir, 'header_fuzzer.py') });

  // 3. JAR built for a Java newer than Burp's runtime
  bapp('a3f9e2b8c1d04e6fb7a5c9d2e8f1b304', { ExtensionType: 1, Name: 'Token Inspector', ScreenVersion: '3.0.1', Author: 'Demo Labs', ShortDescription: 'Decodes and edits session tokens.', EntryPoint: 'token-inspector-3.0.1-all.jar', ProOnly: 'False' }, {
    'token-inspector-3.0.1-all.jar': makeZip({
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n',
      'dev/demo/token/TokenInspector.class': fakeClass(javaVersion + 4, [MONTOYA]),
      'dev/demo/token/ui/TokenPanel.class': fakeClass(javaVersion + 4),
      'dev/demo/token/codec/Jwt.class': fakeClass(17),
    }),
  });
  add({ name: 'Token Inspector', extension_type: 'java', loaded: false, bapp_uuid: 'a3f9e2b8c1d04e6fb7a5c9d2e8f1b304', bapp_serial_version: 12, extension_file: 'bapps\\a3f9e2b8c1d04e6fb7a5c9d2e8f1b304\\token-inspector-3.0.1-all.jar' });

  // 4. Out-of-date path after a BApp update renamed the JAR
  bapp('7c2e4f6a8b0d4e1f9a3c5e7b9d1f2a64', { ExtensionType: 1, Name: 'Param Scout', ScreenVersion: '2.2.0', Author: 'Demo Labs', ShortDescription: 'Finds hidden parameters.', EntryPoint: 'build/libs/param-scout-2.2.0-all.jar', BuildCommand: 'gradle build', ProOnly: 'False' }, {
    'build/libs/param-scout-2.2.0-all.jar': makeZip({ 'dev/demo/scout/Scout.class': fakeClass(17, [MONTOYA]) }),
  });
  add({ name: 'Param Scout', extension_type: 'java', loaded: false, bapp_uuid: '7c2e4f6a8b0d4e1f9a3c5e7b9d1f2a64', bapp_serial_version: 9, extension_file: 'bapps\\7c2e4f6a8b0d4e1f9a3c5e7b9d1f2a64\\build\\libs\\param-scout-2.1.0-all.jar' });

  // 5. Truncated JAR (interrupted download)
  const full = makeZip({ 'burp/BurpExtender.class': fakeClass(11, [LEGACY]), 'dev/demo/log/Table.class': fakeClass(11) });
  const brokenDir = path.join(root, 'Extensions');
  writeFile(path.join(brokenDir, 'request-journal-1.2.jar'), full.subarray(0, Math.floor(full.length * 0.6)));
  add({ name: 'Request Journal', extension_type: 'java', loaded: false, extension_file: path.join(brokenDir, 'request-journal-1.2.jar') });

  // 6. Library JAR picked instead of the extension JAR
  writeFile(path.join(brokenDir, 'graphql-scanner-core-0.9.jar'), makeZip({
    'dev/demo/gql/Parser.class': fakeClass(17),
    'dev/demo/gql/Schema.class': fakeClass(17),
  }));
  add({ name: 'GraphQL Scanner', extension_type: 'java', loaded: false, extension_file: path.join(brokenDir, 'graphql-scanner-core-0.9.jar') });

  // 7. File deleted after it was added
  add({ name: 'Cookie Monitor', extension_type: 'python', loaded: false, extension_file: path.join(root, 'Downloads', 'cookie_monitor.py') });

  // 8. Python 2 syntax error
  writeFile(path.join(brokenDir, 'scope_notifier.py'), [
    'from burp import IBurpExtender',
    '',
    'class BurpExtender(IBurpExtender):',
    '    def registerExtenderCallbacks(self, callbacks):',
    '        callbacks.setExtensionName("Scope Notifier")',
    '        for host in ["a", "b"]',
    '            callbacks.printOutput(host)',
    '',
  ].join('\n'));
  add({ name: 'Scope Notifier', extension_type: 'python', loaded: false, extension_file: path.join(brokenDir, 'scope_notifier.py') });

  // 9. Healthy but switched off
  bapp('e8b1d3f5a7c94e2b8d0f6a4c2e9b7d15', { ExtensionType: 1, Name: 'Response Highlighter', ScreenVersion: '1.1.0', Author: 'Demo Labs', ShortDescription: 'Highlights responses that match rules.', EntryPoint: 'response-highlighter.jar', ProOnly: 'False' }, {
    'response-highlighter.jar': makeZip({ 'dev/demo/hl/Highlighter.class': fakeClass(17, [MONTOYA]) }),
  });
  add({ name: 'Response Highlighter', extension_type: 'java', loaded: false, bapp_uuid: 'e8b1d3f5a7c94e2b8d0f6a4c2e9b7d15', bapp_serial_version: 3, extension_file: 'bapps\\e8b1d3f5a7c94e2b8d0f6a4c2e9b7d15\\response-highlighter.jar' });

  // 10-15. Loaded and fine
  const okNames = ['Request Timer', 'Encoder Toolkit', 'Session Swapper', 'Scope Sync', 'Link Extractor', 'Payload Library'];
  okNames.forEach((name, i) => {
    const uuid = (i + 1).toString(16).padStart(2, '0') + 'b0c4d6e8f04a2c4e6a8c0e2f4a6c8e0';
    const file = name.toLowerCase().replace(/\s+/g, '-') + '.jar';
    bapp(uuid, { ExtensionType: 1, Name: name, ScreenVersion: '1.' + i + '.0', Author: 'Demo Labs', ShortDescription: 'Demo extension.', EntryPoint: file, ProOnly: 'False' }, {
      [file]: makeZip({ ['dev/demo/ok' + i + '/Main.class']: fakeClass(17, [MONTOYA]) }),
    });
    add({ name, extension_type: 'java', loaded: true, bapp_uuid: uuid, bapp_serial_version: 1, extension_file: 'bapps\\' + uuid + '\\' + file });
  });

  const config = {
    user_options: {
      extender: {
        extensions: exts,
        java: { folder_for_loading_library_jar_files: '' },
        python: { folder_for_loading_modules: modulesDir, location_of_jython_standalone_jar_file: jythonPath },
        ruby: { location_of_jruby_jar_file: '' },
        settings: { automatically_reload_extensions_on_startup: false, automatically_update_bapps_on_startup: true },
      },
    },
  };
  writeFile(path.join(burpDir, 'UserConfig.json'), JSON.stringify(config, null, 4));

  return {
    root,
    configPath: path.join(burpDir, 'UserConfig.json'),
    burpDir: installDir,
    jythonPath,
    aliases: [
      { prefix: roaming, label: '%APPDATA%' },
      { prefix: local, label: '%LOCALAPPDATA%' },
      { prefix: path.join(root, 'Extensions'), label: '%USERPROFILE%\\Extensions' },
      { prefix: path.join(root, 'Downloads'), label: '%USERPROFILE%\\Downloads' },
      { prefix: root, label: '%USERPROFILE%' },
    ],
  };
}

// Demo options for diagnose(): reuses the Jython JAR from the real Burp settings when there is one,
// so the demo can show the real Jython compiler at work.
function demoOptions(extra = {}) {
  let jythonJar = process.env.BEC_JYTHON || null;
  if (!jythonJar) {
    try {
      const locate = require('./engine/locate');
      const cfg = locate.findConfigFiles(locate.burpConfigDir())[0];
      if (cfg) {
        const j = JSON.parse(fs.readFileSync(cfg, 'utf8').replace(/^﻿/, ''));
        jythonJar = (((j.user_options || {}).extender || {}).python || {}).location_of_jython_standalone_jar_file || null;
      }
    } catch { /* no real Burp settings */ }
  }
  const d = buildDemo({ jythonJar, ...extra });
  return { configPath: d.configPath, burpDir: d.burpDir, aliases: d.aliases, demo: true };
}

module.exports = { buildDemo, demoOptions, makeZip, fakeClass };

'use strict';
// Checks for Python (Jython) extensions:
//  - syntax check with the real Jython jar Burp is configured to use (compile only, never executes code)
//  - import scan: finds modules that Jython will not be able to import
//  - Python 3 detection (Burp runs Jython 2.7, which cannot run Python 3 code)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { openZip } = require('./zip');

// Modules that Jython 2.7 implements in Java (sys.builtin_module_names). Used when Jython cannot be run.
const JYTHON_BUILTINS = [
  '__builtin__', '_ast', '_bytecodetools', '_codecs', '_collections', '_csv', '_functools', '_hashlib', '_io',
  '_json', '_jythonlib', '_marshal', '_py_compile', '_random', '_sre', '_systemrestart', '_threading', '_weakref',
  'array', 'binascii', 'bz2', 'cPickle', 'cStringIO', 'cmath', 'errno', 'exceptions', 'gc', 'imp', 'itertools',
  'jarray', 'jffi', 'math', 'operator', 'posix', 'nt', 'struct', 'sys', 'synchronize', 'thread', 'time', 'zipimport',
  '_jython', '_imp', '_locale', 'unicodedata', '_fileio', '_jcollections', '_jyio',
];

// Python 2.7 standard library (top-level names). Used when the Jython JAR cannot be read.
const PY27_STDLIB = (
  '__future__ _abcoll _strptime _threading_local abc aifc anydbm argparse ast asynchat asyncore atexit audiodev base64 ' +
  'BaseHTTPServer Bastion bdb binhex bisect calendar cgi CGIHTTPServer cgitb chunk cmd code codecs codeop collections ' +
  'colorsys commands compileall ConfigParser contextlib Cookie cookielib copy copy_reg csv ctypes datetime dbexts decimal ' +
  'difflib dircache dis distutils doctest DocXMLRPCServer dumbdbm dummy_thread dummy_threading email encodings ensurepip ' +
  'filecmp fileinput fnmatch formatter fpformat fractions ftplib functools future_builtins genericpath getopt getpass ' +
  'gettext glob gzip hashlib heapq hmac htmlentitydefs htmllib HTMLParser httplib ihooks imaplib imghdr importlib ' +
  'inspect io isql javapath javashell json keyword linecache locale logging macpath macurl2path mailbox mailcap markupbase ' +
  'md5 mhlib mimetools mimetypes MimeWriter mimify modjy multifile mutex netrc new nntplib ntpath nturl2path numbers ' +
  'opcode optparse os os2emxpath pawt pdb pickle pickletools pipes pkgutil platform plistlib popen2 poplib posixfile ' +
  'posixpath pprint profile pstats pty pwd py_compile pycimport pyclbr pydoc pydoc_data Queue quopri random re readline ' +
  'repr rfc822 rlcompleter robotparser runpy sched select sets sgmllib sha shelve shlex shutil signal site SimpleHTTPServer ' +
  'SimpleXMLRPCServer smtpd smtplib sndhdr socket SocketServer sqlite3 sre sre_compile sre_constants sre_parse ssl stat ' +
  'statvfs string StringIO stringold struct subprocess sunau sunaudio symbol sysconfig tabnanny tarfile telnetlib tempfile ' +
  'test textwrap this threading timeit token tokenize trace traceback tty types unittest urllib urllib2 urlparse user ' +
  'UserDict UserList UserString uu uuid warnings weakref webbrowser whichdb wsgiref xdrlib xml xmllib xmlrpclib zipfile zlib ' +
  'zipimport bz2 cmath crypt grp resource termios'
).split(' ');

// Top-level names that resolve to Java packages (or are provided by Burp at runtime).
const JAVA_ROOTS = new Set(['java', 'javax', 'burp', 'org', 'com', 'net', 'sun', 'jdk', 'io', 'jarray', 'jython', 'jythonlib', 'jarray']);

// Popular CPython packages that cannot work in Jython (C extensions) or are not installed with it.
const KNOWN_PIP = {
  requests: 'requests is a pip package. Jython has no pip packages installed by default; copy a pure-Python version into the "Folder for loading modules" or use java.net / urllib2 instead.',
  urllib3: 'urllib3 is a pip package. Copy a pure-Python version into the "Folder for loading modules".',
  bs4: 'BeautifulSoup is a pip package. Copy a pure-Python version into the "Folder for loading modules".',
  yaml: 'PyYAML is a pip package with C parts. Use a pure-Python YAML module or Java\'s SnakeYAML instead.',
  numpy: 'numpy is a C extension and can never run on Jython.',
  pandas: 'pandas is a C extension and can never run on Jython.',
  lxml: 'lxml is a C extension and can never run on Jython. Use xml.etree or Java XML APIs.',
  cryptography: 'cryptography is a C extension and can never run on Jython. Use javax.crypto instead.',
  Crypto: 'PyCrypto/PyCryptodome is a C extension and can never run on Jython. Use javax.crypto instead.',
  Cryptodome: 'PyCryptodome is a C extension and can never run on Jython. Use javax.crypto instead.',
  jwt: 'PyJWT is a pip package. Copy a pure-Python version into the "Folder for loading modules".',
  six: 'six is a pip package. Copy six.py into the "Folder for loading modules".',
  dns: 'dnspython is a pip package. Copy a pure-Python version into the "Folder for loading modules".',
  tldextract: 'tldextract is a pip package. Copy a pure-Python version into the "Folder for loading modules".',
  aiohttp: 'aiohttp needs Python 3 asyncio and a C extension; it can never run on Jython.',
  asyncio: 'asyncio is Python 3 only; Jython 2.7 does not have it.',
  pathlib: 'pathlib is Python 3 only; Jython 2.7 does not have it.',
  typing: 'typing is Python 3 only; Jython 2.7 does not have it.',
  dataclasses: 'dataclasses is Python 3 only; Jython 2.7 does not have it.',
  concurrent: 'concurrent.futures is Python 3 only (a "futures" backport exists for 2.7).',
  enum: 'enum is Python 3 only on Jython 2.7 (the "enum34" backport can be copied into the modules folder).',
};

// ---------------------------------------------------------------- import scan
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function extractImports(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let inTriple = null;
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    // skip triple-quoted blocks (docstrings) — rough but good enough for import lines
    const tq = raw.match(/"""|'''/g);
    if (inTriple) {
      if (raw.includes(inTriple)) inTriple = null;
      continue;
    }
    if (tq && tq.length % 2 === 1 && !/^\s*(import|from)\s/.test(raw)) { inTriple = tq[0]; continue; }
    const line = stripComment(raw);
    const indent = line.match(/^\s*/)[0].length;
    const optional = indent > 0 && isInsideTry(lines, i, indent);
    let m = line.match(/^\s*import\s+(.+)$/);
    if (m) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_][\w.]*$/.test(name)) out.push({ module: name, line: i + 1, optional });
      }
      continue;
    }
    m = line.match(/^\s*from\s+([.\w]+)\s+import\b/);
    if (m && !m[1].startsWith('.')) out.push({ module: m[1], line: i + 1, optional });
  }
  return out;
}

// True when the import at lines[idx] sits in a try:/except: block (so a failure is usually handled).
function isInsideTry(lines, idx, indent) {
  for (let j = idx - 1; j >= 0 && j >= idx - 25; j--) {
    const l = stripComment(lines[j]);
    if (!l.trim()) continue;
    const ind = l.match(/^\s*/)[0].length;
    // inside "try:" or a fallback "except ...:" branch
    if (ind < indent) return /^\s*(try|except\b[^:]*)\s*:/.test(l);
  }
  return false;
}

// Signs that a file is Python 3 code. Used as an explanation next to a Jython syntax error,
// or on its own when Jython is not available.
function python3Hints(src) {
  const hints = [];
  const lines = src.split(/\r?\n/);
  const rules = [
    [/(^|[^\w])(f|rf|fr|F|Rf)"[^"]*\{[^}]+\}/, 'f-string (Python 3.6+)'],
    [/(^|[^\w])(f|rf|fr|F|Rf)'[^']*\{[^}]+\}/, 'f-string (Python 3.6+)'],
    [/^\s*async\s+def\s/, '"async def" (Python 3.5+)'],
    [/\bawait\s+[\w(]/, '"await" (Python 3.5+)'],
    [/^\s*nonlocal\s/, '"nonlocal" (Python 3)'],
    [/^\s*def\s+\w+\s*\([^)]*\)\s*->/, 'return type annotation "->" (Python 3)'],
    [/:=/, 'walrus operator ":=" (Python 3.8+)'],
    [/^\s*print\s*\(.*\bend\s*=/, 'print(..., end=...) without "from __future__ import print_function"'],
    [/^\s*except\s+[\w.]+\s*,\s*\w+\s*:/, null], // py2 style (ignored)
  ];
  const hasPrintFuture = /from\s+__future__\s+import\s+[^\n]*print_function/.test(src);
  for (let i = 0; i < lines.length && hints.length < 5; i++) {
    const l = stripComment(lines[i]);
    for (const [re, label] of rules) {
      if (!label) continue;
      if (label.startsWith('print(') && hasPrintFuture) continue;
      if (re.test(l)) { hints.push({ line: i + 1, label, text: lines[i].trim().slice(0, 140) }); break; }
    }
  }
  return hints;
}

// ---------------------------------------------------------------- jython jar
function inspectJythonJar(file) {
  const zip = openZip(file);
  try {
    const stdlib = new Set();
    let hasMain = false;
    let version = null;
    for (const e of zip.entries) {
      if (e.name === 'org/python/util/jython.class') hasMain = true;
      if (e.name.startsWith('Lib/')) {
        const rest = e.name.slice(4);
        const top = rest.split('/')[0];
        if (!top) continue;
        if (rest.includes('/')) stdlib.add(top);
        else if (/\.py$/.test(top)) stdlib.add(top.replace(/\.py$/, ''));
        else if (/\$py\.class$/.test(top)) stdlib.add(top.replace(/\$py\.class$/, ''));
      }
      if (!version && /META-INF\/maven\/org\.python\/jython[^/]*\/pom\.properties$/.test(e.name)) {
        try {
          const m = zip.read(e).toString('utf8').match(/version=([^\r\n]+)/);
          if (m) version = m[1].trim();
        } catch { /* ignore */ }
      }
    }
    if (!version) {
      const m = path.basename(file).match(/jython[^\d]*([\d.]+\d(?:[a-z]+\d*)?)/i);
      if (m) version = m[1];
    }
    const hasLib = stdlib.size > 0;
    return { hasMain, hasLib, standalone: hasMain && hasLib, stdlib: [...stdlib], version, entries: zip.entries.length };
  } finally {
    zip.close();
  }
}

// ---------------------------------------------------------------- jython run
const CHECK_SCRIPT = [
  'import sys',
  'import codecs',
  'def u(x):',
  '    if x is None:',
  '        return None',
  '    if isinstance(x, unicode):',
  '        return x',
  '    try:',
  '        return str(x).decode("utf-8")',
  '    except Exception:',
  '        return str(x).decode("latin-1")',
  'try:',
  '    import json',
  'except ImportError:',
  '    json = None',
  'res = {"version": sys.version, "builtins": list(sys.builtin_module_names), "files": []}',
  'lf = codecs.open(sys.argv[1], "r", "utf-8")',
  'paths = [x for x in lf.read().splitlines() if x.strip()]',
  'lf.close()',
  'for p in paths:',
  '    r = {"file": p}',
  '    try:',
  '        f = open(p, "rb")',
  '        try:',
  '            src = f.read()',
  '        finally:',
  '            f.close()',
  '        compile(src, p, "exec")',
  '        r["ok"] = True',
  '    except SyntaxError as e:',
  '        r["ok"] = False',
  '        r["kind"] = e.__class__.__name__',
  '        r["msg"] = u(e.msg)',
  '        r["line"] = e.lineno',
  '        r["offset"] = e.offset',
  '        r["text"] = u(e.text)',
  '    except Exception as e:',
  '        r["ok"] = False',
  '        r["kind"] = e.__class__.__name__',
  '        r["msg"] = u(e)',
  '    res["files"].append(r)',
  'sys.stdout.write("@@BEC@@" + json.dumps(res) + "\\n")',
  '',
].join('\n');

function runJythonCheck(javaExe, jythonJar, files, { timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bec-jy-'));
    const script = path.join(work, 'bec_check.py');
    fs.writeFileSync(script, CHECK_SCRIPT);
    fs.writeFileSync(path.join(work, 'files.txt'), files.join('\n'), 'utf8');
    const args = [
      '-Dpython.cachedir.skip=true',
      '-Dpython.console.encoding=UTF-8',
      '-Dpython.import.site=false',
      '-Xss8m',
      '-jar', jythonJar, 'bec_check.py', 'files.txt',
    ];
    let out = '';
    let err = '';
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve(r);
    };
    let child;
    try {
      child = spawn(javaExe, args, { cwd: work, windowsHide: true });
    } catch (e) {
      finish({ ok: false, error: 'could not start Java: ' + e.message });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish({ ok: false, error: 'Jython did not finish within ' + Math.round(timeoutMs / 1000) + ' seconds' });
    }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); finish({ ok: false, error: 'could not start Java: ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const i = out.lastIndexOf('@@BEC@@');
      if (i < 0) {
        finish({ ok: false, error: 'Jython exited with code ' + code + '. ' + (err || out).trim().slice(-800) });
        return;
      }
      try {
        const data = JSON.parse(out.slice(i + 7).split(/\r?\n/)[0]);
        finish({ ok: true, ...data });
      } catch (e) {
        finish({ ok: false, error: 'unexpected Jython output: ' + out.slice(i, i + 300) });
      }
    });
  });
}

// ---------------------------------------------------------------- module resolution
function moduleExistsIn(dir, top) {
  if (!dir) return null;
  const cands = [
    path.join(dir, top + '.py'),
    path.join(dir, top + '$py.class'),
    path.join(dir, top + '.class'),
    path.join(dir, top, '__init__.py'),
    path.join(dir, top + '.jar'),
  ];
  for (const c of cands) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ }
  }
  try { if (fs.statSync(path.join(dir, top)).isDirectory()) return path.join(dir, top); } catch { /* none */ }
  return null;
}

// Follows local imports so helper modules shipped with the extension are syntax-checked too.
function collectLocalFiles(mainFile, searchDirs, limit = 60) {
  const seen = new Set();
  const queue = [mainFile];
  const files = [];
  while (queue.length && files.length < limit) {
    const f = queue.shift();
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let src;
    try { src = fs.readFileSync(f, 'latin1'); } catch { continue; }
    files.push({ file: f, src, imports: extractImports(src) });
    for (const imp of files[files.length - 1].imports) {
      const top = imp.module.split('.')[0];
      for (const d of [path.dirname(f), ...searchDirs]) {
        const hit = moduleExistsIn(d, top);
        if (hit) {
          if (hit.endsWith('.py')) queue.push(hit);
          else if (hit.endsWith('__init__.py')) queue.push(hit);
          else {
            // package directory: check the submodule file if it exists
            const sub = imp.module.split('.').slice(1);
            if (sub.length) {
              const subFile = path.join(d, top, ...sub) + '.py';
              if (fs.existsSync(subFile)) queue.push(subFile);
            }
            const init = path.join(d, top, '__init__.py');
            if (fs.existsSync(init)) queue.push(init);
          }
          break;
        }
      }
    }
  }
  return files;
}

module.exports = {
  extractImports, python3Hints, inspectJythonJar, runJythonCheck, collectLocalFiles, moduleExistsIn,
  JYTHON_BUILTINS, JAVA_ROOTS, KNOWN_PIP, PY27_STDLIB,
};

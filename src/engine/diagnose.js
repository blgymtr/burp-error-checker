'use strict';
// Orchestrates every check and returns one plain JSON result that the UI, the CLI
// and the report writers all share. Read-only: nothing in Burp's folders is changed.

const fs = require('fs');
const path = require('path');
const locate = require('./locate');
const { analyzeJar } = require('./java');
const py = require('./python');
const { makeDisplay, scrubText } = require('./paths');

const SEV_RANK = { error: 3, warning: 2, info: 1, ok: 0 };

function readManifest(dir) {
  const p = path.join(dir, 'BappManifest.bmf');
  if (!locate.isFile(p)) return null;
  const m = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return m;
}

function resolveExtFile(configDir, rel) {
  if (!rel) return null;
  const norm = String(rel).replace(/[\\/]/g, path.sep);
  return path.isAbsolute(norm) ? norm : path.join(configDir, norm);
}

function kb(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function worst(findings) {
  let w = 'ok';
  for (const f of findings) if (SEV_RANK[f.severity] > SEV_RANK[w]) w = f.severity;
  return w;
}

const TYPE_LABEL = { java: 'Java', python: 'Python', ruby: 'Ruby' };
const EXPECTED_EXT = { java: ['.jar'], python: ['.py'], ruby: ['.rb'] };

async function diagnose(opts = {}) {
  const progress = opts.onProgress || (() => {});
  const env = opts.env || process.env;
  const display = makeDisplay(opts.aliases || []);
  const started = Date.now();

  const result = {
    tool: 'Burp Error Checker',
    version: opts.appVersion || null,
    generatedAt: new Date().toISOString(),
    durationMs: 0,
    config: {},
    environment: [],
    extensions: [],
    summary: {},
  };
  const envItem = (item) => { result.environment.push(item); return item; };

  // ------------------------------------------------------------ config
  progress({ pct: 2, message: 'Reading Burp user settings' });
  const configDir = opts.configPath ? path.dirname(opts.configPath) : locate.burpConfigDir(env);
  const configFile = opts.configPath || locate.findConfigFiles(configDir)[0] || null;
  result.config = { dir: configDir, dirDisplay: display(configDir), file: configFile, fileDisplay: display(configFile) };

  let extender = null;
  if (!configFile) {
    envItem({
      id: 'config', label: 'Burp user settings', status: 'error', value: 'Not found',
      detail: 'No UserConfig.json was found in ' + display(configDir) + '. Start Burp Suite once so it creates the file, or pick the file in Settings.',
    });
  } else {
    try {
      const raw = fs.readFileSync(configFile, 'utf8').replace(/^﻿/, '');
      const json = JSON.parse(raw);
      const uo = json.user_options || json;
      extender = uo.extender || null;
      if (!extender) throw new Error('the file has no "user_options.extender" section');
      const st = fs.statSync(configFile);
      result.config.modified = st.mtime.toISOString();
      envItem({
        id: 'config', label: 'Burp user settings', status: 'ok', value: path.basename(configFile),
        detail: display(configFile) + ' · last saved ' + st.mtime.toLocaleString('en-GB'),
      });
    } catch (e) {
      envItem({
        id: 'config', label: 'Burp user settings', status: 'error', value: 'Unreadable',
        detail: 'Could not read ' + display(configFile) + ': ' + e.message,
      });
    }
  }

  const exts = (extender && Array.isArray(extender.extensions)) ? extender.extensions : [];
  const pySettings = (extender && extender.python) || {};
  const javaSettings = (extender && extender.java) || {};
  const rubySettings = (extender && extender.ruby) || {};
  const types = new Set(exts.map(e => e.extension_type));

  // ------------------------------------------------------------ Burp runtime
  progress({ pct: 6, message: "Looking for Burp's Java runtime" });
  const install = locate.findBurpInstall(opts.burpDir, env);
  let runtimeMajor = opts.runtimeMajor || null;
  if (install && install.jre) {
    runtimeMajor = runtimeMajor || install.jre.major;
    envItem({
      id: 'runtime', label: 'Burp Java runtime', status: 'ok', value: 'Java ' + install.jre.version,
      detail: 'Bundled with Burp in ' + display(install.dir) + '. Java extensions must be compiled for Java ' + install.jre.major + ' or older.',
    });
  } else {
    envItem({
      id: 'runtime', label: 'Burp Java runtime', status: 'info', value: install ? 'Unknown version' : 'Burp not found',
      detail: (install ? 'Burp was found in ' + display(install.dir) + ' but its bundled Java version could not be read.' : 'No Burp installation was found in the usual folders.') +
        ' The Java version check for JAR files is skipped. You can point to the Burp folder in Settings.',
    });
  }
  result.burp = { installDir: install ? install.dir : null, installDisplay: install ? display(install.dir) : null, javaMajor: runtimeMajor };

  // ------------------------------------------------------------ Jython
  progress({ pct: 10, message: 'Checking the Jython configuration' });
  const jythonPath = opts.jythonPath || pySettings.location_of_jython_standalone_jar_file || '';
  const jython = { path: jythonPath || null, display: display(jythonPath), usable: false, problem: null, info: null };
  const hasPython = types.has('python');
  if (!jythonPath) {
    jython.problem = {
      severity: hasPython ? 'error' : 'info',
      title: 'Jython is not configured',
      detail: 'Burp needs the Jython standalone JAR to run Python extensions, and no JAR is set.',
      fix: [
        'Download "jython-standalone-2.7.x.jar" from jython.org (Downloads page).',
        'In Burp open Settings → Extensions → Python environment.',
        'Set "Location of Jython standalone JAR file" to the downloaded file.',
        'Go to Extensions → Installed and tick the Python extensions again.',
      ],
    };
  } else if (!locate.isFile(jythonPath)) {
    jython.problem = {
      severity: hasPython ? 'error' : 'warning',
      title: 'The configured Jython JAR does not exist',
      detail: 'Burp is set to use ' + display(jythonPath) + ', but there is no file at that path. It was probably moved or deleted.',
      fix: [
        'Put jython-standalone-2.7.x.jar back at that path, or',
        'in Burp open Settings → Extensions → Python environment and select the JAR at its new location.',
      ],
    };
  } else {
    try {
      jython.info = py.inspectJythonJar(jythonPath);
      if (!jython.info.hasMain) {
        jython.problem = {
          severity: 'error', title: 'The configured file is not a Jython JAR',
          detail: display(jythonPath) + ' is a valid archive but does not contain Jython (org/python/util/jython.class is missing).',
          fix: ['Download jython-standalone-2.7.x.jar from jython.org and select it in Settings → Extensions → Python environment.'],
        };
      } else if (!jython.info.hasLib) {
        jython.problem = {
          severity: 'error', title: 'This is the plain Jython JAR, not the standalone one',
          detail: 'The selected JAR has no bundled Python standard library (no Lib/ folder). Burp needs the "standalone" build, otherwise even "import os" fails.',
          fix: ['Download jython-standalone-2.7.x.jar (the file name must contain "standalone") and select it in Settings → Extensions → Python environment.'],
        };
      } else {
        jython.usable = true;
        if (jython.info.version && /^2\.[0-6]\b/.test(jython.info.version)) {
          jython.problem = {
            severity: 'warning', title: 'Old Jython version ' + jython.info.version,
            detail: 'Most BApp Store extensions require Jython 2.7.',
            fix: ['Use jython-standalone-2.7.4.jar or newer.'],
          };
        }
      }
    } catch (e) {
      jython.problem = {
        severity: 'error', title: 'The configured Jython JAR is damaged',
        detail: display(jythonPath) + ' could not be opened as a JAR: ' + e.message + '. A partly finished download is the usual cause.',
        fix: ['Download jython-standalone-2.7.x.jar again from jython.org and select it in Settings → Extensions → Python environment.'],
      };
    }
  }
  envItem({
    id: 'jython', label: 'Jython (Python support)',
    status: jython.problem ? jython.problem.severity : 'ok',
    value: jython.usable ? 'Jython ' + (jython.info.version || '2.7') : (jythonPath ? 'Problem' : 'Not set'),
    detail: jython.problem ? jython.problem.title + '. ' + jython.problem.detail : display(jythonPath) + ' · standalone, ' + jython.info.stdlib.length + ' standard library modules',
  });
  result.jython = { path: jythonPath || null, display: display(jythonPath), usable: jython.usable, version: jython.info && jython.info.version };

  // modules folder for Python
  const modulesDir = pySettings.folder_for_loading_modules || '';
  if (modulesDir) {
    const ok = locate.isDir(modulesDir);
    envItem({
      id: 'pymodules', label: 'Python modules folder', status: ok ? 'ok' : 'warning', value: ok ? 'Found' : 'Missing',
      detail: ok ? display(modulesDir) : 'Burp is set to load Python modules from ' + display(modulesDir) + ', but the folder does not exist.',
    });
  }

  // Java libraries folder
  const javaLibDir = javaSettings.folder_for_loading_library_jar_files || '';
  if (javaLibDir && !locate.isDir(javaLibDir)) {
    envItem({
      id: 'javalibs', label: 'Java libraries folder', status: 'warning', value: 'Missing',
      detail: 'Burp is set to load extra JAR libraries from ' + display(javaLibDir) + ', but the folder does not exist.',
    });
  }

  // JRuby
  const jrubyPath = rubySettings.location_of_jruby_jar_file || '';
  let jrubyProblem = null;
  if (types.has('ruby')) {
    if (!jrubyPath) jrubyProblem = { severity: 'error', title: 'JRuby is not configured', detail: 'Burp needs the JRuby complete JAR to run Ruby extensions, and no JAR is set.', fix: ['Download jruby-complete-x.y.z.jar from jruby.org.', 'Select it in Settings → Extensions → Ruby environment.'] };
    else if (!locate.isFile(jrubyPath)) jrubyProblem = { severity: 'error', title: 'The configured JRuby JAR does not exist', detail: 'Burp is set to use ' + display(jrubyPath) + ', but there is no file at that path.', fix: ['Select the JRuby complete JAR again in Settings → Extensions → Ruby environment.'] };
    envItem({ id: 'jruby', label: 'JRuby (Ruby support)', status: jrubyProblem ? 'error' : 'ok', value: jrubyProblem ? 'Problem' : 'Configured', detail: jrubyProblem ? jrubyProblem.detail : display(jrubyPath) });
  }

  // Java used by this checker for the Jython syntax check
  progress({ pct: 14, message: 'Looking for Java to run Jython' });
  const java = locate.findJava(opts.javaPath, install, env);
  const needJava = hasPython && jython.usable && !opts.skipJython;
  if (needJava || java.path) {
    envItem({
      id: 'checkerJava', label: 'Java for syntax checks',
      status: java.path ? 'ok' : (needJava ? 'warning' : 'info'),
      value: java.path ? 'Java ' + java.version : 'Not found',
      detail: java.path
        ? 'Used to run Jython in compile-only mode. Source: ' + java.source + (java.path !== 'java' ? ' (' + display(java.path) + ')' : '') + '.'
        : 'No Java runtime was found, so Python files are only checked with simple rules instead of the real Jython compiler. Set a java executable in Settings.',
    });
  }
  result.checkerJava = java.path ? { path: java.path, display: display(java.path), version: java.version, source: java.source } : null;

  // ------------------------------------------------------------ extensions
  const targets = exts.filter(e => opts.includeLoaded || !e.loaded);
  const outExt = [];

  // First pass: per-extension file checks, gather python files for one Jython run
  const pyJobs = [];
  for (let i = 0; i < exts.length; i++) {
    const e = exts[i];
    const type = e.extension_type || 'unknown';
    const file = resolveExtFile(configDir, e.extension_file);
    const item = {
      id: 'ext-' + i,
      name: e.name || '(unnamed extension)',
      type,
      typeLabel: TYPE_LABEL[type] || type,
      loaded: !!e.loaded,
      analyzed: targets.includes(e),
      file,
      fileDisplay: display(file),
      configuredPath: e.extension_file || '',
      configuredDisplay: e.extension_file ? (path.isAbsolute(String(e.extension_file)) ? display(file) : e.extension_file) : '',
      folder: file ? path.dirname(file) : null,
      errorsTo: e.errors || null,
      outputTo: e.output || null,
      bapp: null,
      checks: [],
      findings: [],
      status: 'loaded',
    };
    outExt.push(item);

    if (e.bapp_uuid) {
      const bdir = path.join(configDir, 'bapps', e.bapp_uuid);
      const man = locate.isDir(bdir) ? readManifest(bdir) : null;
      item.bapp = { uuid: e.bapp_uuid, dir: bdir, dirDisplay: display(bdir), present: locate.isDir(bdir), manifest: man };
      if (man) {
        item.bapp.version = man.ScreenVersion || null;
        item.bapp.author = man.Author || null;
        item.bapp.description = man.ShortDescription || null;
        item.bapp.entryPoint = man.EntryPoint || null;
        item.bapp.proOnly = /^true$/i.test(man.ProOnly || '');
      }
    }
    if (!item.analyzed) continue;

    const add = (f) => item.findings.push(f);
    const check = (label, status, note) => item.checks.push({ label, status, note: note || '' });

    // --- path in config
    if (!e.extension_file) {
      check('Extension file path in settings', 'error', 'empty');
      add({ severity: 'error', code: 'no-path', title: 'No file path is saved for this extension', detail: 'Burp has an entry for this extension but no file to load.', fix: ['Remove the extension in Extensions → Installed and add it again.'] });
      continue;
    }
    check('Extension file path in settings', 'ok', item.configuredDisplay);

    // --- file exists
    let st = null;
    try { st = fs.statSync(file); } catch { /* missing */ }
    if (!st || !st.isFile()) {
      check('File exists', 'error', 'not found');
      const f = { severity: 'error', code: 'missing-file', title: 'The extension file is missing', detail: 'Burp tries to load ' + display(file) + ', but that file does not exist.', fix: [] };
      if (item.bapp) {
        const entry = item.bapp.entryPoint ? path.join(item.bapp.dir, item.bapp.entryPoint.replace(/[\\/]/g, path.sep)) : null;
        if (!item.bapp.present) {
          f.detail += ' The whole BApp folder (' + item.bapp.dirDisplay + ') is gone, so the BApp was deleted or Burp\'s settings were copied from another computer.';
          f.fix = ['Open Extensions → BApp Store in Burp, find "' + item.name + '" and click Reinstall (or Install).'];
        } else if (entry && entry.toLowerCase() !== file.toLowerCase() && locate.isFile(entry)) {
          f.title = 'The saved path is out of date';
          f.detail += ' The BApp folder now contains the extension at ' + display(entry) + '. This happens when a BApp update renames its file and the saved path is not updated.';
          f.fix = ['Open Extensions → BApp Store, select "' + item.name + '" and click Reinstall. Burp will save the new path.'];
        } else if (item.bapp.manifest && item.bapp.manifest.BuildCommand) {
          f.detail += ' This BApp is built from source on install ("' + item.bapp.manifest.BuildCommand + '") and the build output is missing, so the install or an update did not finish.';
          f.fix = ['Open Extensions → BApp Store, select "' + item.name + '" and click Reinstall.', 'If it keeps failing, check your internet connection or proxy settings for Burp\'s own updates.'];
        } else {
          f.fix = ['Open Extensions → BApp Store, select "' + item.name + '" and click Reinstall.'];
        }
      } else {
        f.detail += ' It was moved, renamed or deleted after it was added to Burp.';
        f.fix = ['Put the file back at that path, or', 'remove the extension in Extensions → Installed and add it again from its new location.'];
      }
      add(f);
      continue;
    }
    if (st.size === 0) {
      check('File exists', 'error', 'empty file (0 bytes)');
      add({ severity: 'error', code: 'empty-file', title: 'The extension file is empty', detail: display(file) + ' is 0 bytes. A download or update was interrupted.', fix: [item.bapp ? 'Reinstall the BApp from Extensions → BApp Store.' : 'Replace the file with a fresh copy.'] });
      continue;
    }
    check('File exists', 'ok', path.basename(file) + ' · ' + kb(st.size));

    // --- type vs extension
    const ext = path.extname(file).toLowerCase();
    const expected = EXPECTED_EXT[type];
    if (expected && !expected.includes(ext)) {
      check('File type matches extension type', 'warning', ext + ' file registered as ' + item.typeLabel);
      add({ severity: 'warning', code: 'type-mismatch', title: 'File type does not match the extension type', detail: 'The extension is registered as ' + item.typeLabel + ' but the file ends in "' + ext + '". Burp will try to load it with the wrong engine.', fix: ['Remove it in Extensions → Installed and add it again, choosing the correct "Extension type".'] });
    } else if (expected) {
      check('File type matches extension type', 'ok', item.typeLabel);
    }

    // --- BApp edition
    if (item.bapp && item.bapp.proOnly && /community/i.test(path.basename(configFile || ''))) {
      add({ severity: 'error', code: 'pro-only', title: 'This BApp requires Burp Suite Professional', detail: 'The BApp manifest says ProOnly, and these settings belong to Burp Suite Community Edition.', fix: ['Use Burp Suite Professional, or remove the extension.'] });
    }

    // --- per type
    if (type === 'java') {
      progress({ pct: 18 + Math.round(40 * i / Math.max(1, exts.length)), message: 'Inspecting ' + item.name });
      try {
        const jar = await analyzeJar(file);
        item.jar = { classes: jar.classCount, entries: jar.entries, maxJava: jar.maxJava };
        check('JAR archive can be opened', 'ok', jar.entries + (jar.entries === 1 ? ' entry, ' : ' entries, ') + jar.classCount + (jar.classCount === 1 ? ' class' : ' classes'));
        if (jar.classCount === 0) {
          add({ severity: 'error', code: 'jar-empty', title: 'The JAR contains no Java classes', detail: 'There is nothing Burp can load from this file. It may be a source or resources archive instead of the built extension.', fix: [item.bapp ? 'Reinstall the BApp.' : 'Build the extension (for example "gradle build" or "mvn package") and load the JAR from build/libs or target/.'] });
        }
        if (jar.unreadable.length) {
          add({ severity: 'error', code: 'jar-corrupt', title: 'Some classes in the JAR are damaged', detail: jar.unreadable.length + ' class file(s) could not be read. First: ' + jar.unreadable[0], fix: [item.bapp ? 'Reinstall the BApp.' : 'Rebuild the JAR or download it again.'] });
        }
        // entry point
        if (jar.classCount > 0) {
          if (jar.legacyEntry || jar.montoyaClasses.length) {
            check('Burp entry point', 'ok', jar.montoyaClasses.length ? 'Montoya API (' + jar.montoyaClasses[0].replace(/\.class$/, '').replace(/\//g, '.') + ')' : 'legacy API (burp.BurpExtender)');
          } else if (jar.legacyImplementers.length) {
            check('Burp entry point', 'error', 'burp.BurpExtender missing');
            add({ severity: 'error', code: 'legacy-wrong-name', title: 'The entry class has the wrong name', detail: 'The JAR implements the legacy Burp API (IBurpExtender) in ' + jar.legacyImplementers[0].replace(/\.class$/, '').replace(/\//g, '.') + ', but Burp only looks for a class named exactly burp.BurpExtender.', fix: ['Move or rename the class to package "burp", class "BurpExtender", or port it to the Montoya API.'] });
          } else {
            check('Burp entry point', 'error', 'none found');
            add({ severity: 'error', code: 'no-entry', title: 'No Burp entry point in the JAR', detail: 'Burp loads either a class named burp.BurpExtender (legacy API) or a class that implements burp.api.montoya.BurpExtension (Montoya API). Neither was found, so this is not a Burp extension JAR, or it is a library JAR that the real extension depends on.', fix: ['Check that you picked the right JAR. Projects often build several; use the one named "*-all.jar", "*-jar-with-dependencies.jar" or "*-shadow.jar".'] });
          }
        }
        // java version
        if (jar.maxJava) {
          if (runtimeMajor && jar.maxJava > runtimeMajor) {
            check('Compiled for a Java version Burp can run', 'error', 'needs Java ' + jar.maxJava + ', Burp has Java ' + runtimeMajor);
            add({ severity: 'error', code: 'java-too-new', title: 'Compiled for Java ' + jar.maxJava + ', but Burp runs Java ' + runtimeMajor, detail: 'The class ' + jar.maxMajorClass.replace(/\.class$/, '').replace(/\//g, '.') + ' needs Java ' + jar.maxJava + '. Burp fails with UnsupportedClassVersionError when it loads it.', fix: ['Update Burp Suite (newer versions ship a newer Java), or', 'rebuild the extension with "release = ' + runtimeMajor + '" (Gradle: java { toolchain { languageVersion = JavaLanguageVersion.of(' + runtimeMajor + ') } }; Maven: <maven.compiler.release>' + runtimeMajor + '</maven.compiler.release>).'] });
          } else {
            check('Compiled for a Java version Burp can run', 'ok', 'Java ' + jar.maxJava + (runtimeMajor ? ' ≤ ' + runtimeMajor : ''));
          }
        }
      } catch (err) {
        check('JAR archive can be opened', 'error', err.message);
        add({ severity: 'error', code: 'jar-broken', title: 'The JAR file is damaged', detail: display(file) + ' is not a readable JAR/ZIP archive (' + err.message + '). A download or build was cut off, or the file is not a JAR at all.', fix: [item.bapp ? 'Open Extensions → BApp Store, select "' + item.name + '" and click Reinstall.' : 'Download or build the JAR again.'] });
      }
    } else if (type === 'python') {
      if (jython.problem && (jython.problem.severity === 'error')) {
        add({ ...jython.problem, code: 'jython' });
        check('Jython available', 'error', jython.problem.title);
      } else {
        check('Jython available', 'ok', 'Jython ' + ((jython.info && jython.info.version) || ''));
      }
      const searchDirs = [modulesDir].filter(Boolean);
      const files = py.collectLocalFiles(file, searchDirs);
      pyJobs.push({ item, files, searchDirs, main: file });
    } else if (type === 'ruby') {
      if (jrubyProblem) { add({ ...jrubyProblem, code: 'jruby' }); check('JRuby available', 'error', jrubyProblem.title); }
      else check('JRuby available', 'ok', display(jrubyPath));
    }
  }

  // ------------------------------------------------------------ Python: one Jython run for everything
  if (pyJobs.length) {
    const allFiles = [...new Set(pyJobs.flatMap(j => j.files.map(f => f.file)))];
    let jy = null;
    if (jython.usable && java.path && !opts.skipJython) {
      progress({ pct: 62, message: 'Compiling ' + allFiles.length + ' Python file(s) with Jython (compile only, nothing is executed)' });
      jy = await py.runJythonCheck(java.path, jythonPath, allFiles, { timeoutMs: opts.jythonTimeoutMs || 240000 });
      if (!jy.ok) {
        envItem({ id: 'jythonRun', label: 'Jython syntax check', status: 'warning', value: 'Failed to run', detail: scrubText(jy.error, display, [jythonPath, java.path]) + '. Python files were checked with simple rules instead.' });
      }
    }
    const byFile = new Map();
    if (jy && jy.ok) for (const r of jy.files) byFile.set(String(r.file).toLowerCase(), r);
    const builtins = new Set((jy && jy.ok && jy.builtins) || py.JYTHON_BUILTINS);
    const stdlib = new Set((jython.info && jython.info.stdlib && jython.info.stdlib.length) ? jython.info.stdlib : py.PY27_STDLIB);

    progress({ pct: 88, message: 'Checking Python imports' });
    for (const job of pyJobs) {
      const { item } = job;
      const add = (f) => item.findings.push(f);
      const check = (label, status, note) => item.checks.push({ label, status, note: note || '' });
      const rel = (f) => path.relative(path.dirname(job.main), f) || path.basename(f);

      // syntax
      if (jy && jy.ok) {
        const bad = job.files.map(f => ({ f, r: byFile.get(f.file.toLowerCase()) })).filter(x => x.r && !x.r.ok);
        if (!bad.length) {
          check('Python syntax (real Jython compiler)', 'ok', job.files.length + ' file(s) compiled');
        } else {
          check('Python syntax (real Jython compiler)', 'error', bad.length + ' of ' + job.files.length + ' file(s) failed');
          for (const { f, r } of bad.slice(0, 3)) {
            const hints = py.python3Hints(f.src);
            const isPy3 = hints.length > 0;
            const srcLine = r.line ? (f.src.split(/\r?\n/)[r.line - 1] || '').replace(/\t/g, '    ') : (r.text || '');
            add({
              severity: 'error', code: isPy3 ? 'python3' : 'syntax',
              title: isPy3 ? 'Python 3 code: Burp runs Jython 2.7' : 'Python syntax error',
              detail: (isPy3
                ? 'Burp runs Python extensions with Jython, which is Python 2.7. This file uses Python 3 features (' + [...new Set(hints.map(h => h.label))].join(', ') + '), so it cannot be compiled.'
                : 'Jython could not compile ' + rel(f.file) + '. Burp shows this as an error the moment the extension loads.'),
              evidence: {
                file: display(f.file), line: r.line || null, message: (r.kind || 'Error') + ': ' + (r.msg || ''),
                code: srcLine ? srcLine.replace(/\s+$/, '') : null, offset: r.offset || null,
              },
              fix: isPy3
                ? ['Use a Python 2.7 / Jython version of this extension (check the project\'s releases or branches), or', 'port the code to Python 2.7 syntax (replace f-strings with "%" or .format(), remove type hints and async code).']
                : ['Fix the line shown above, or get an unmodified copy of the extension (for BApps: Reinstall from the BApp Store).'],
            });
          }
        }
      } else {
        const hints = py.python3Hints(job.files[0] ? job.files[0].src : '');
        if (hints.length) {
          check('Python syntax (simple rules, Jython not run)', 'warning', 'Python 3 features found');
          add({ severity: 'warning', code: 'python3-guess', title: 'Looks like Python 3 code', detail: 'Burp runs Jython 2.7 (Python 2). This file uses ' + [...new Set(hints.map(h => h.label))].join(', ') + '. The real Jython compiler could not be run to confirm it.', evidence: { file: display(job.main), line: hints[0].line, message: hints[0].label, code: hints[0].text }, fix: ['Use a Python 2.7 / Jython version of the extension.'] });
        } else {
          check('Python syntax (simple rules, Jython not run)', 'info', 'no Python 3 features found');
        }
      }

      // imports
      const missing = new Map();
      for (const f of job.files) {
        for (const imp of f.imports) {
          const top = imp.module.split('.')[0];
          if (builtins.has(top) || stdlib.has(top) || py.JAVA_ROOTS.has(top) || top === '__future__') continue;
          const dirs = [path.dirname(f.file), path.dirname(job.main), ...job.searchDirs];
          if (dirs.some(d => py.moduleExistsIn(d, top))) continue;
          const key = top;
          if (!missing.has(key)) missing.set(key, { module: top, where: [], optional: true });
          const m = missing.get(key);
          m.where.push(rel(f.file) + ':' + imp.line);
          if (!imp.optional) m.optional = false;
        }
      }
      const required = [...missing.values()].filter(m => !m.optional);
      const optional = [...missing.values()].filter(m => m.optional);
      if (!required.length) check('Imported modules can be found', optional.length ? 'info' : 'ok', optional.length ? optional.length + ' optional import(s) missing' : 'all imports resolved');
      else check('Imported modules can be found', 'error', required.map(m => m.module).join(', ') + ' missing');
      if (required.length) {
        add({
          severity: 'error', code: 'missing-module',
          title: required.length === 1 ? 'Missing Python module "' + required[0].module + '"' : required.length + ' Python modules are missing',
          detail: 'Jython cannot find ' + required.map(m => '"' + m.module + '"').join(', ') + '. Loading stops with "ImportError: No module named ..." before the extension starts. Jython does not see modules installed with pip for normal Python.',
          modules: required.map(m => ({ module: m.module, where: m.where.slice(0, 3), note: py.KNOWN_PIP[m.module] || null })),
          fix: [
            'Copy the pure-Python module into a folder and set that folder in Settings → Extensions → Python environment → "Folder for loading modules".',
            'Pick a release of the module that still supports Python 2.7 (PyPI → "Release history" → "Download files"), unpack it and copy the module folder there.',
            'Modules with C code (numpy, lxml, cryptography…) can never run on Jython; the extension needs a Jython-compatible alternative.',
          ],
        });
      }
      if (optional.length) {
        add({ severity: 'info', code: 'optional-module', title: 'Optional modules not found', detail: 'These imports are inside a try: block, so the extension probably handles their absence: ' + optional.map(m => m.module).join(', ') + '.', modules: optional.map(m => ({ module: m.module, where: m.where.slice(0, 3), note: py.KNOWN_PIP[m.module] || null })), fix: [] });
      }
    }
  }

  // ------------------------------------------------------------ status per extension
  for (const item of outExt) {
    if (!item.analyzed) { item.status = 'loaded'; continue; }
    const w = worst(item.findings);
    if (!item.loaded) {
      item.status = (w === 'error' || w === 'warning') ? w : 'unknown';
      if (item.status === 'unknown') {
        const where = item.errorsTo === 'ui' || !item.errorsTo
          ? 'Burp shows runtime errors in Extensions → Installed → select the extension → Errors tab.'
          : 'This extension\'s errors are sent to "' + item.errorsTo + '" (see its Output/Errors settings in Extensions → Installed).';
        item.findings.push({
          severity: 'info', code: 'no-static-cause',
          title: 'No problem found in the files',
          detail: 'Every static check passed, so the extension is either simply switched off (unticked in Extensions → Installed) or fails while it runs (for example a missing Java library, a network call at startup, or an exception in its code). ' + where,
          fix: ['Tick the "Loaded" box for the extension in Extensions → Installed.', 'If it unticks itself again, open its Errors tab and read the first stack trace line.'],
        });
      }
    } else {
      item.status = (w === 'error' || w === 'warning') ? w : 'loaded';
    }
    item.findings.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  }

  const order = { error: 0, warning: 1, unknown: 2, loaded: 3 };
  outExt.sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name));
  result.extensions = outExt;
  result.summary = {
    total: outExt.length,
    loaded: outExt.filter(e => e.loaded).length,
    notLoaded: outExt.filter(e => !e.loaded).length,
    errors: outExt.filter(e => e.status === 'error').length,
    warnings: outExt.filter(e => e.status === 'warning').length,
    unknown: outExt.filter(e => e.status === 'unknown').length,
    environmentProblems: result.environment.filter(x => x.status === 'error' || x.status === 'warning').length,
  };
  result.durationMs = Date.now() - started;
  progress({ pct: 100, message: 'Done' });
  return result;
}

module.exports = { diagnose };

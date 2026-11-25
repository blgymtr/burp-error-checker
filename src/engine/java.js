'use strict';
// Static checks for Java (.jar) extensions: archive integrity, Burp entry point,
// and the Java class-file version compared with the Java runtime Burp ships with.

const { openZip } = require('./zip');

const LEGACY_ENTRY = 'burp/BurpExtender.class';
const MONTOYA_IFACE = Buffer.from('burp/api/montoya/BurpExtension');
const LEGACY_IFACE = Buffer.from('burp/IBurpExtender');

const MAX_SCAN_BYTES = 256 * 1024 * 1024; // stop deep scanning after 256 MB of class data

function classMajorToJava(major) {
  return major >= 45 ? major - 44 : null;
}

const tick = () => new Promise(r => setImmediate(r));

// Returns a summary of the jar. Throws ZipError when the archive itself is unreadable.
async function analyzeJar(file) {
  const zip = openZip(file);
  try {
    const res = {
      entries: zip.entries.length,
      classCount: 0,
      maxMajor: 0,
      maxMajorClass: null,
      legacyEntry: false,
      montoyaClasses: [],
      legacyImplementers: [],
      bundlesMontoyaApi: false,
      multiRelease: false,
      unreadable: [],
      scanTruncated: false,
      manifest: null,
    };
    let scanned = 0;
    let n = 0;
    for (const e of zip.entries) {
      if (e.name === 'META-INF/MANIFEST.MF') {
        try { res.manifest = zip.read(e).toString('utf8'); } catch { /* ignore */ }
        continue;
      }
      if (!e.name.endsWith('.class')) continue;
      if (e.name.startsWith('META-INF/versions/')) { res.multiRelease = true; continue; }
      if (e.name.endsWith('module-info.class')) continue;
      res.classCount++;
      if (e.name === LEGACY_ENTRY) res.legacyEntry = true;
      if (e.name.startsWith('burp/api/montoya/')) { res.bundlesMontoyaApi = true; continue; }
      if (scanned > MAX_SCAN_BYTES) { res.scanTruncated = true; continue; }
      let data;
      try {
        data = zip.read(e);
      } catch (err) {
        res.unreadable.push(e.name + ': ' + err.message);
        continue;
      }
      scanned += data.length;
      if (data.length >= 8 && data.readUInt32BE(0) === 0xcafebabe) {
        const major = data.readUInt16BE(6);
        if (major > res.maxMajor) { res.maxMajor = major; res.maxMajorClass = e.name; }
      } else {
        res.unreadable.push(e.name + ': not a valid Java class file');
      }
      if (data.indexOf(MONTOYA_IFACE) >= 0 && !e.name.startsWith('burp/api/')) res.montoyaClasses.push(e.name);
      if (data.indexOf(LEGACY_IFACE) >= 0 && e.name !== 'burp/IBurpExtender.class') res.legacyImplementers.push(e.name);
      if (++n % 150 === 0) await tick();
    }
    res.maxJava = classMajorToJava(res.maxMajor);
    return res;
  } finally {
    zip.close();
  }
}

module.exports = { analyzeJar, classMajorToJava };

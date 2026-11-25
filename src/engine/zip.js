'use strict';
// Minimal, dependency-free ZIP/JAR reader.
// Reads only the central directory up front, then individual entries on demand,
// so even a 50 MB Jython jar can be listed without loading it into memory.

const fs = require('fs');
const zlib = require('zlib');

class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = fs.readSync(fd, buf, off, len - off, pos + off);
    if (n === 0) break;
    off += n;
  }
  return off === len ? buf : buf.subarray(0, off);
}

class ZipFile {
  constructor(file) {
    this.file = file;
    this.fd = fs.openSync(file, 'r');
    try {
      this.size = fs.fstatSync(this.fd).size;
      this.entries = this._readCentralDirectory();
    } catch (e) {
      this.close();
      throw e;
    }
  }

  close() {
    if (this.fd !== null && this.fd !== undefined) {
      try { fs.closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
  }

  _readCentralDirectory() {
    if (this.size < 22) throw new ZipError('file is too small to be a ZIP/JAR archive');
    const tailLen = Math.min(this.size, 22 + 0xffff);
    const tailPos = this.size - tailLen;
    const tail = readAt(this.fd, tailPos, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new ZipError('no ZIP end-of-central-directory record (not a JAR, or the file is truncated)');

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locPos = eocd - 20;
      if (locPos >= 0 && tail.readUInt32LE(locPos) === SIG_EOCD64_LOC) {
        const eocd64Pos = Number(tail.readBigUInt64LE(locPos + 8));
        const rec = readAt(this.fd, eocd64Pos, 56);
        if (rec.readUInt32LE(0) !== SIG_EOCD64) throw new ZipError('broken ZIP64 directory record');
        count = Number(rec.readBigUInt64LE(32));
        cdSize = Number(rec.readBigUInt64LE(40));
        cdOffset = Number(rec.readBigUInt64LE(48));
      }
    }

    if (cdOffset + cdSize > this.size) throw new ZipError('central directory points past the end of the file (the file is truncated)');
    const cd = readAt(this.fd, cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CEN) {
        throw new ZipError('central directory is damaged at entry ' + i);
      }
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      if (compSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) {
        // ZIP64 extra field
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = cd.readUInt16LE(e);
          const len = cd.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
            if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
            break;
          }
          e += 4 + len;
        }
      }
      entries.push({ name, method, compSize, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  read(entry, maxBytes) {
    const hdr = readAt(this.fd, entry.offset, 30);
    if (hdr.length < 30 || hdr.readUInt32LE(0) !== SIG_LOC) throw new ZipError('local header of "' + entry.name + '" is damaged');
    const dataPos = entry.offset + 30 + hdr.readUInt16LE(26) + hdr.readUInt16LE(28);
    if (dataPos + entry.compSize > this.size) throw new ZipError('"' + entry.name + '" is cut off (the file is truncated)');
    const raw = readAt(this.fd, dataPos, entry.compSize);
    if (entry.method === 0) return maxBytes ? raw.subarray(0, maxBytes) : raw;
    if (entry.method === 8) {
      try {
        return zlib.inflateRawSync(raw, maxBytes ? { maxOutputLength: Math.max(maxBytes, 64) } : undefined);
      } catch (e) {
        if (maxBytes && e && e.code === 'ERR_BUFFER_TOO_LARGE') {
          // fall back to a full inflate and slice
          return zlib.inflateRawSync(raw).subarray(0, maxBytes);
        }
        throw new ZipError('"' + entry.name + '" could not be decompressed: ' + (e && e.message));
      }
    }
    throw new ZipError('"' + entry.name + '" uses unsupported compression method ' + entry.method);
  }
}

function openZip(file) {
  return new ZipFile(file);
}

module.exports = { openZip, ZipError };

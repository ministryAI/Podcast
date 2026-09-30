// Local recording library, kept in the browser's Origin Private File System (OPFS).
// Layout: sessions/<id>/meta.json, sessions/<id>/<file>.webm, sessions/<id>/thumb.jpg
// Nothing here ever touches the Downloads folder.

const root = () => navigator.storage.getDirectory();

async function dir(path, create = true) {
  let d = await root();
  for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
  return d;
}

export async function persist() {
  try { return await navigator.storage.persist(); } catch { return false; }
}

export async function usage() {
  try { return await navigator.storage.estimate(); } catch { return {}; }
}

// ---------- metadata ----------
export async function readMeta(id) {
  try {
    const f = await (await dir(`sessions/${id}`, false)).getFileHandle('meta.json');
    return JSON.parse(await (await f.getFile()).text());
  } catch { return null; }
}

const metaLocks = {};
// Serialized read-modify-write so concurrent updates don't clobber each other.
export function updateMeta(id, fn) {
  const run = async () => {
    const meta = (await readMeta(id)) || { id, created: Date.now(), takes: [], tracks: [] };
    fn(meta);
    meta.updated = Date.now();
    const h = await (await dir(`sessions/${id}`)).getFileHandle('meta.json', { create: true });
    const w = await h.createWritable();
    await w.write(JSON.stringify(meta));
    await w.close();
    return meta;
  };
  return (metaLocks[id] = (metaLocks[id] || Promise.resolve()).then(run, run));
}

export async function listSessions() {
  const out = [];
  try {
    for await (const [name, h] of (await dir('sessions')).entries()) {
      if (h.kind !== 'directory') continue;
      const m = await readMeta(name);
      if (m) out.push(m);
    }
  } catch {}
  return out.sort((a, b) => b.created - a.created);
}

export async function deleteSession(id) {
  await (await dir('sessions')).removeEntry(id, { recursive: true });
}

// ---------- files ----------
export async function removeFile(id, name) {
  try {
    const d = await dir(`sessions/${id}`, false);
    await d.removeEntry(name);
    let empty = true; for await (const _ of d.keys()) { empty = false; break; }
    if (empty) await deleteSession(id);
  } catch {}
}

export async function getFile(id, name) {
  const h = await (await dir(`sessions/${id}`, false)).getFileHandle(name);
  return h.getFile();
}

export async function fileSize(id, name) {
  try { return (await getFile(id, name)).size; } catch { return 0; }
}

export async function writeWhole(id, name, blob) {
  const h = await (await dir(`sessions/${id}`)).getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(blob);
  await w.close();
}

// Crash-safe file writer backed by a worker (see file-worker.js).
let worker, seq = 0;
const pending = new Map();
function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./file-worker.js', import.meta.url));
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id); pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.data ?? data.size);
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

export class FileWriter {
  constructor(id, name) {
    this.path = `sessions/${id}/${name}`;
    this.size = 0;
    this.ready = call({ op: 'size', path: this.path }).then(s => (this.size = s));
  }
  // Write bytes at a position (defaults to the end). Resolves to the new file size.
  async write(data, position) {
    const buf = data instanceof Blob ? await data.arrayBuffer() : data;
    await this.ready;
    return (this.size = await call({ op: 'write', path: this.path, data: buf, pos: position }, [buf]));
  }
  async truncate(size) { await this.ready; return (this.size = await call({ op: 'truncate', path: this.path, size })); }
  // Read bytes back (the file is locked while open, so reads go through the worker too).
  async read(pos, len) { await this.ready; return call({ op: 'read', path: this.path, pos, len }); }
  close() { return call({ op: 'close', path: this.path }); }
}

// ---------- helpers ----------
export const fmtBytes = n => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round((n || 0) / 1e3) + ' KB';
export const fmtDur = ms => {
  const s = Math.round((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
};
export const safeName = s => (s || 'guest').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'guest';

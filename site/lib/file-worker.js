// OPFS writer running in a worker so we can use createSyncAccessHandle():
// in-place writes, no whole-file copies, flushed after every chunk (crash safe).
const handles = new Map();

async function open(path) {
  let d = await navigator.storage.getDirectory();
  const parts = path.split('/');
  const name = parts.pop();
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(name, { create: true });
  return fh.createSyncAccessHandle();
}

let q = Promise.resolve();
self.onmessage = ({ data }) => { q = q.then(() => handle(data)); };

async function handle(m) {
  try {
    let h = handles.get(m.path);
    if (!h && m.op !== 'close') handles.set(m.path, h = await open(m.path));
    let size = h ? h.getSize() : 0;
    if (m.op === 'write') {
      const buf = new Uint8Array(m.data);
      h.write(buf, { at: m.pos ?? size });
      h.flush();
      size = h.getSize();
    } else if (m.op === 'truncate') {
      h.truncate(m.size); h.flush(); size = m.size;
    } else if (m.op === 'read') {
      const len = Math.max(0, Math.min(m.len, size - m.pos));
      const buf = new Uint8Array(len);
      h.read(buf, { at: m.pos });
      return self.postMessage({ id: m.id, size, data: buf.buffer }, [buf.buffer]);
    } else if (m.op === 'close') {
      h?.close(); handles.delete(m.path);
    }
    self.postMessage({ id: m.id, size });
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e) });
  }
}

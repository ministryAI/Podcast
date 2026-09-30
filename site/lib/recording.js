// Riverside-style local recording + progressive transfer to the host.
//
// Every participant records their own camera/mic with MediaRecorder into OPFS.
// Guests stream their file to the host *while recording* over a dedicated binary
// RTCDataChannel added to VDO.Ninja's existing peer connection (negotiated id,
// so no renegotiation). Chunks carry their byte offset, so resends are idempotent
// and a dropped connection resumes where it left off.
import { FileWriter } from './store.js';

const CHANNEL_ID = 1017;
const CHUNK = 60 * 1024;              // payload bytes per message
const HIGH_WATER = 2 * 1024 * 1024;   // pause sending above this bufferedAmount
const HEADER = 12;                    // u32 take + f64 position

export const QUALITY = {
  '1080': { video: 6_000_000, audio: 256_000, label: '1080p video' },
  '720': { video: 2_500_000, audio: 256_000, label: '720p video (recommended)' },
  audio: { video: 0, audio: 256_000, label: 'Audio only' },
};

function pickMime(audioOnly) {
  const opts = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return opts.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// ---------------- local recorder ----------------
export class LocalRecorder {
  constructor({ stream, sessionId, file, quality = '720', onBytes }) {
    const q = QUALITY[quality] || QUALITY['720'];
    const audioOnly = !q.video || !stream.getVideoTracks().length;
    const tracks = audioOnly ? stream.getAudioTracks() : stream.getTracks();
    this.mime = pickMime(audioOnly);
    this.writer = new FileWriter(sessionId, file);
    this.rec = new MediaRecorder(new MediaStream(tracks), {
      mimeType: this.mime, videoBitsPerSecond: q.video || undefined, audioBitsPerSecond: q.audio,
    });
    this.writes = Promise.resolve();
    this.rec.ondataavailable = e => {
      if (!e.data.size) return;
      this.writes = this.writes.then(() => this.writer.write(e.data)).then(size => onBytes?.(size));
    };
    this.started = Date.now();
    this.rec.start(1000);
  }
  stop() {
    return new Promise(resolve => {
      this.rec.onstop = async () => { await this.writes; this.duration = Date.now() - this.started; resolve(this.writer.size); };
      this.rec.state === 'inactive' ? this.rec.onstop() : this.rec.stop();
    });
  }
}

// Attach our negotiated channel to a VDO.Ninja RTCPeerConnection.
export function openChannel(pc) {
  if (!pc || pc.connectionState === 'closed') return null;
  if (pc.__studioChannel && pc.__studioChannel.readyState !== 'closed') return pc.__studioChannel;
  try {
    const ch = pc.createDataChannel('studio-files', { negotiated: true, id: CHANNEL_ID, ordered: true });
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = HIGH_WATER / 2;
    return (pc.__studioChannel = ch);
  } catch (e) {
    console.warn('studio channel', e);
    return null;
  }
}

// ---------------- guest: uploader ----------------
// takes: Map take -> { file, name, writer, recording, sent, acked }
export class Uploader {
  constructor({ onProgress, onAck }) {
    this.onAck = onAck;
    this.takes = new Map();
    this.onProgress = onProgress;
    this.ch = null;
  }
  addTake(take, { file, name, writer }) {
    this.takes.set(take, { file, name, writer, recording: true, sent: 0, acked: false });
    this.ctrl({ t: 'meta', take, file, name });
    this.pump();
  }
  finishTake(take) {
    const t = this.takes.get(take);
    if (t) { t.recording = false; this.pump(); }
  }
  attach(ch) {
    if (this.ch === ch) return;
    this.ch = ch;
    ch.onopen = () => {
      // (Re)introduce every unfinished take; the host answers with how much it has.
      for (const [take, t] of this.takes) if (!t.acked) t.endSent = false, this.ctrl({ t: 'meta', take, file: t.file, name: t.name });
      this.pump();
    };
    ch.onbufferedamountlow = () => this.pump();
    ch.onmessage = e => {
      if (typeof e.data !== 'string') return;
      const m = JSON.parse(e.data), t = this.takes.get(m.take);
      if (!t) return;
      if (m.t === 'have') { t.sent = Math.min(m.bytes, t.writer.size); t.endSent = false; this.pump(); }
      if (m.t === 'ack' && !t.acked) { t.acked = true; this.onAck?.(m.take, t); this.report(); }
    };
    if (ch.readyState === 'open') ch.onopen();
  }
  ctrl(m) { if (this.ch?.readyState === 'open') this.ch.send(JSON.stringify(m)); }

  async pump() {
    if (this.pumping) return (this.again = true);
    this.pumping = true;
    try {
      do {
        this.again = false;
        for (const [take, t] of this.takes) {
          while (!t.acked && this.ch?.readyState === 'open' && this.ch.bufferedAmount < HIGH_WATER && t.sent < t.writer.size) {
            const data = await t.writer.read(t.sent, CHUNK);
            if (!data.byteLength) break;
            const msg = new Uint8Array(HEADER + data.byteLength);
            const dv = new DataView(msg.buffer);
            dv.setUint32(0, take); dv.setFloat64(4, t.sent);
            msg.set(new Uint8Array(data), HEADER);
            this.ch.send(msg.buffer);
            t.sent += data.byteLength;
          }
          if (!t.recording && !t.acked && !t.endSent && t.sent >= t.writer.size) { t.endSent = true; this.ctrl({ t: 'end', take, size: t.writer.size }); }
        }
        this.report();
      } while (this.again);
    } catch (e) { console.warn('upload', e); }
    this.pumping = false;
  }
  // Called when the recorder writes more bytes.
  poke() { this.pump(); }

  report() {
    let total = 0, sent = 0, pending = false;
    for (const t of this.takes.values()) {
      total += t.writer.size; sent += t.acked ? t.writer.size : Math.min(t.sent, t.writer.size);
      if (!t.acked) pending = true;
    }
    this.onProgress?.({ total, sent, pending, recording: [...this.takes.values()].some(t => t.recording) });
  }
  get done() { return [...this.takes.values()].every(t => t.acked); }
}

// ---------------- host: receiver ----------------
export class Receiver {
  // onTrack(file, info) is called when a new guest track starts; onProgress(file, bytes); onComplete(file, size)
  constructor({ sessionId, onTrack, onProgress, onComplete }) {
    Object.assign(this, { sessionId, onTrack, onProgress, onComplete });
    this.files = new Map(); // "UUID:take" -> { writer, file }
  }
  attach(ch, UUID) {
    if (ch.__studioAttached) return;
    ch.__studioAttached = true;
    ch.onmessage = async e => {
      if (typeof e.data === 'string') return this.control(ch, UUID, JSON.parse(e.data));
      const dv = new DataView(e.data);
      const take = dv.getUint32(0), pos = dv.getFloat64(4);
      const f = this.files.get(UUID + ':' + take);
      if (!f) return;
      const size = await f.writer.write(e.data.slice(HEADER), pos);
      this.onProgress?.(f.file, size);
    };
  }
  async control(ch, UUID, m) {
    const key = UUID + ':' + m.take;
    let f = this.files.get(key);
    if (m.t === 'meta') {
      if (!f) {
        f = { file: m.file, writer: new FileWriter(this.sessionId, m.file) };
        this.files.set(key, f);
        this.onTrack?.(m.file, { name: m.name, take: m.take });
      }
      await f.writer.ready;
      ch.send(JSON.stringify({ t: 'have', take: m.take, bytes: f.writer.size }));
    } else if (m.t === 'end' && f) {
      // Wait for queued writes before comparing sizes
      await f.writer.write(new ArrayBuffer(0));
      if (f.writer.size >= m.size) {
        if (f.writer.size > m.size) await f.writer.truncate(m.size);
        await f.writer.close();
        ch.send(JSON.stringify({ t: 'ack', take: m.take }));
        this.onComplete?.(f.file, m.size);
      } else {
        ch.send(JSON.stringify({ t: 'have', take: m.take, bytes: f.writer.size }));
      }
    }
  }
}

// Podcast Studio: a branded shell around VDO.Ninja (served from ./app/),
// driven through its iframe API. Recording is our own (lib/recording.js):
// saved in browser storage and streamed to the host, never to Downloads.
import { LocalRecorder, Uploader, Receiver, openChannel } from './lib/recording.js';
import { updateMeta, readMeta, persist, safeName, fmtBytes, writeWhole, removeFile } from './lib/store.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = params.get('room');
const show = params.get('show') || 'Podcast Studio';
const password = params.get('pw') || '';
const isHost = params.get('host') === '1';
const wss = params.get('wss'); // optional self-hosted handshake server

if (!room) location.replace('./');

const toast = msg => {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('toast').classList.remove('show'), 2200);
};

function inviteLink() {
  const q = new URLSearchParams({ room, show });
  if (password) q.set('pw', password);
  if (wss) q.set('wss', wss);
  return new URL('studio.html?' + q, location.href).href;
}

/* ---------------- Green room ---------------- */
$('showName').textContent = show;
$('greeting').textContent = isHost ? 'Get ready to host' : `You're invited to ${show}`;
let savedName = ''; try { savedName = localStorage.getItem('studio-name') || ''; } catch {}
$('name').value = params.get('name') || savedName;

let previewStream, meterRaf, audioCtx;

async function startPreview() {
  stopPreview();
  const cam = $('cam').value, mic = $('mic').value;
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({
      video: cam ? { deviceId: { exact: cam } } : true,
      audio: mic ? { deviceId: { exact: mic } } : true,
    });
  } catch (err) {
    $('previewOff').textContent = 'Camera/microphone blocked: ' + err.message;
    return;
  }
  $('previewOff').hidden = true;
  $('preview').srcObject = previewStream;
  await listDevices();

  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  audioCtx.createMediaStreamSource(previewStream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    $('meter').style.width = Math.min(100, peak / 128 * 180) + '%';
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
}

function stopPreview() {
  cancelAnimationFrame(meterRaf);
  previewStream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();
  previewStream = audioCtx = null;
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const active = kind => previewStream?.getTracks().find(t => t.kind === kind)?.getSettings().deviceId;
  for (const [sel, kind, track] of [['cam', 'videoinput', 'video'], ['mic', 'audioinput', 'audio']]) {
    const current = active(track);
    $(sel).replaceChildren(...devices.filter(d => d.kind === kind).map((d, i) => {
      const o = new Option(d.label || `${kind} ${i + 1}`, d.deviceId);
      o.selected = d.deviceId === current;
      return o;
    }));
  }
}

$('cam').onchange = $('mic').onchange = startPreview;
startPreview();

$('joinForm').onsubmit = e => {
  e.preventDefault();
  const name = $('name').value.trim();
  try { localStorage.setItem('studio-name', name); } catch {}
  const camLabel = $('cam').selectedOptions[0]?.text;
  const micLabel = $('mic').selectedOptions[0]?.text;
  stopPreview();
  enterStudio(name, camLabel, micLabel);
};

/* ---------------- Studio ---------------- */
const vdo = $('vdo');
const send = msg => vdo.contentWindow?.postMessage(msg, '*');
const vdoSession = () => { try { return vdo.contentWindow.session; } catch { return null; } };
const peers = new Set();
let myName = '', myId = '', hostUUID = null;
let micOn = true, camOn = true, recording = false, recStart = 0, recTimer, take = 0;
let recorder = null, quality = '720';

function enterStudio(name, camLabel, micLabel) {
  myName = name;
  $('greenRoom').hidden = true;
  $('studio').hidden = false;
  $('topShow').textContent = show;
  $('inviteBtn').hidden = $('recBtn').hidden = $('recSep').hidden = !isHost;
  persist();

  myId = (name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'guest') + Math.random().toString(36).slice(2, 6);
  const q = new URLSearchParams({
    room, push: myId, label: name,
    videodevice: camLabel || '1', audiodevice: micLabel || '1',
    quality: '0',
    css: new URL('vdo.css', location.href).href,
  });
  if (password) q.set('password', password);
  if (wss) q.set('wss', wss);
  const flags = ['autostart', 'webcam', 'showlabels', 'hideheader', 'nosettings'];
  vdo.src = 'app/?' + q + '&' + flags.join('&');

  if (isHost) initHost(); else initGuest();
}

/* ---------- host ---------- */
let receiver;
const incoming = new Map(); // file -> { name, bytes, done }

async function initHost() {
  const meta = await readMeta(room);
  quality = meta?.quality || quality;
  await updateMeta(room, m => { m.show = m.show || show; m.host = myName; m.quality = quality; });
  take = (meta?.takes?.length) || 0;
  receiver = new Receiver({
    sessionId: room,
    onTrack: (file, info) => {
      incoming.set(file, { name: info.name, bytes: 0, done: false });
      updateMeta(room, m => { if (!m.tracks.some(t => t.file === file)) m.tracks.push({ file, name: info.name, take: info.take, role: 'guest', status: 'receiving', bytes: 0 }); });
      renderIncoming();
    },
    onProgress: (file, bytes) => { const f = incoming.get(file); if (f) { f.bytes = bytes; renderIncoming(); } },
    onComplete: (file, size) => {
      const f = incoming.get(file); if (f) { f.bytes = size; f.done = true; }
      updateMeta(room, m => { const t = m.tracks.find(t => t.file === file); if (t) { t.status = 'complete'; t.bytes = size; } });
      renderIncoming();
      toast(`${f?.name || 'Guest'}'s recording arrived`);
    },
  });
  // Attach our file channel to every guest connection as they appear.
  setInterval(() => {
    const s = vdoSession(); if (!s) return;
    for (const UUID in s.rpcs) { const ch = openChannel(s.rpcs[UUID]); if (ch) receiver.attach(ch, UUID); }
  }, 1000);
}

function renderIncoming() {
  const busy = [...incoming.values()].filter(f => !f.done);
  $('xferPill').hidden = !busy.length;
  if (busy.length) $('xferPill').textContent = '⇣ ' + busy.map(f => `${f.name} ${fmtBytes(f.bytes)}`).join(' · ');
  renderDoneList();
}

async function hostStartTake() {
  const s = vdoSession();
  if (!s?.streamSrc) return toast('Camera not ready yet');
  take += 1;
  recStart = Date.now();
  const file = `take${take}-${safeName(myName)}-host.webm`;
  recorder = new LocalRecorder({ stream: s.streamSrc, sessionId: room, file, quality });
  await updateMeta(room, m => {
    m.takes.push({ n: take, started: recStart });
    m.tracks.push({ file, name: myName, take, role: 'host', status: 'recording', bytes: 0 });
  });
  saveThumb(s.streamSrc);
  broadcastRec();
}

async function hostStopTake() {
  const r = recorder; recorder = null;
  broadcastRec();
  const size = await r.stop();
  await updateMeta(room, m => {
    const tk = m.takes.find(t => t.n === take); if (tk) tk.duration = r.duration;
    const t = m.tracks.find(t => t.file === r.writer.path.split('/').pop()); if (t) { t.status = 'complete'; t.bytes = size; }
  });
  await r.writer.close();
}

const recState = () => ({ studio: { rec: recording, take, quality, since: recStart } });
function broadcastRec(UUID) { send(UUID ? { sendData: recState(), UUID } : { sendData: recState() }); }

async function saveThumb(stream) {
  const meta = await readMeta(room);
  if (meta?.thumb || !stream.getVideoTracks().length) return;
  const v = document.createElement('video');
  v.muted = true; v.srcObject = new MediaStream(stream.getVideoTracks()); await v.play().catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  const c = document.createElement('canvas'); c.width = 480; c.height = Math.round(480 * (v.videoHeight / v.videoWidth || 9 / 16));
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  v.srcObject = null;
  c.toBlob(async b => { if (b) { await writeWhole(room, 'thumb.jpg', b); updateMeta(room, m => { m.thumb = 'thumb.jpg'; }); } }, 'image/jpeg', .8);
}

/* ---------- guest ---------- */
let uploader;
const outbox = 'outbox-' + room;

function initGuest() {
  uploader = new Uploader({
    onProgress: renderUpload,
    // The host has the whole file, so drop the guest's temporary copy.
    onAck: async (n, t) => { await t.writer.close(); removeFile(outbox, t.file); },
  });
  setInterval(() => {
    const s = vdoSession(); if (!s || !hostUUID) return;
    const ch = openChannel(s.pcs[hostUUID]); if (ch) uploader.attach(ch);
  }, 1000);
}

function guestRec(state) {
  if (state.rec && !recorder) {
    const s = vdoSession(); if (!s?.streamSrc) return;
    take = state.take;
    const file = `take${take}-${safeName(myName)}-${myId}.webm`;
    recorder = new LocalRecorder({ stream: s.streamSrc, sessionId: outbox, file, quality: state.quality, onBytes: () => uploader.poke() });
    uploader.addTake(take, { file, name: myName, writer: recorder.writer });
  } else if (!state.rec && recorder) {
    const r = recorder; recorder = null;
    r.stop().then(() => uploader.finishTake(take));
  }
}

function renderUpload(p) {
  const pct = p.total ? Math.floor(p.sent / p.total * 100) : 0;
  $('xferPill').hidden = !p.total;
  $('xferPill').textContent = p.pending ? `⇡ Sending to host ${pct}%` : '✓ Sent to host';
  $('doneMsg').textContent = p.pending
    ? `Finishing sending your recording to the host… ${pct}%. Please keep this tab open.`
    : 'Your recording has been delivered to the host. You can close this tab.';
  if (!p.pending && leaving) finishLeave();
}

/* ---------- shared ---------- */
addEventListener('message', e => {
  if (e.source !== vdo.contentWindow || !e.data) return;
  const d = e.data;

  if (d.dataReceived?.studio) {
    const s = d.dataReceived.studio;
    if (!isHost) {
      if (d.UUID) hostUUID = d.UUID;
      if ('rec' in s) { setRecording(s.rec, s.since); guestRec(s); }
    }
    return;
  }

  switch (d.action) {
    case 'view-connection':
      if (d.value) {
        peers.add(d.UUID);
        if (isHost) broadcastRec(d.UUID); // introduces the host (and any running take) to newcomers
      } else peers.delete(d.UUID);
      break;
    case 'end-view-connection':
      peers.delete(d.UUID);
      break;
  }
  $('people').textContent = `${peers.size + 1} in studio`;
});

$('micBtn').onclick = () => {
  micOn = !micOn;
  send({ mic: micOn });
  $('micBtn').classList.toggle('off', !micOn);
  $('micBtn').textContent = micOn ? '🎙️' : '🔇';
};
$('camBtn').onclick = () => {
  camOn = !camOn;
  send({ camera: camOn });
  $('camBtn').classList.toggle('off', !camOn);
};
$('setBtn').onclick = () => send({ toggleSettings: 'toggle' });

$('inviteBtn').onclick = async () => {
  const link = inviteLink();
  try { await navigator.clipboard.writeText(link); toast('Guest link copied, send it to your guests'); }
  catch { prompt('Send this link to your guests:', link); }
};

function setRecording(on, since = Date.now()) {
  if (on === recording) return;
  recording = on;
  recStart = since;
  $('recPill').hidden = !on;
  $('recBtn').classList.toggle('on', on);
  $('recBtn').textContent = on ? 'Stop' : 'Record';
  clearInterval(recTimer);
  if (on) {
    const upd = () => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('recPill').textContent = `REC ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    upd();
    recTimer = setInterval(upd, 1000);
    toast(isHost ? 'Recording on everyone\'s computer' : 'The host started recording');
  } else {
    toast(isHost ? 'Recording stopped. Guest files are arriving' : 'Recording stopped. Sending your file to the host');
  }
}

$('recBtn').onclick = async () => {
  $('recBtn').disabled = true;
  try {
    if (!recording) { setRecording(true); await hostStartTake(); }
    else { setRecording(false); await hostStopTake(); }
  } finally { $('recBtn').disabled = false; }
};

let leaving = false;
function renderDoneList() {
  if (!isHost) return;
  const items = [...incoming.values()];
  const busy = items.some(f => !f.done);
  $('doneMsg').textContent = !items.length ? 'Your recording is saved in your library.'
    : busy ? 'Receiving guest recordings. Keep this tab open until they finish:'
    : 'All recordings are saved in your library.';
  $('doneList').replaceChildren(...items.map(f => {
    const li = document.createElement('li');
    li.textContent = `${f.done ? '✓' : '⇣'} ${f.name}: ${fmtBytes(f.bytes)}`;
    return li;
  }));
  $('openLib').hidden = busy;
  if (leaving && !busy) finishLeave();
}

async function finishLeave() {
  send({ hangup: true });
  setTimeout(() => { vdo.src = 'about:blank'; }, 500);
  if (isHost) location.href = `./#/session/${encodeURIComponent(room)}`;
}

$('leaveBtn').onclick = async () => {
  if (recording && !confirm('Recording is still running. Stop and leave?')) return;
  if (recording) {
    setRecording(false);
    if (isHost) await hostStopTake(); else guestRec({ rec: false });
  }
  leaving = true;
  send({ mic: false }); send({ camera: false });
  $('studio').hidden = true;
  $('done').hidden = false;
  $('openLib').href = `./#/session/${encodeURIComponent(room)}`;
  if (isHost) renderDoneList();
  else if (!uploader.takes.size) { $('doneMsg').textContent = 'Thanks for joining!'; finishLeave(); }
  else uploader.report();
};

addEventListener('beforeunload', e => {
  if (recording || (uploader && !uploader.done) || [...incoming.values()].some(f => !f.done)) e.preventDefault();
});

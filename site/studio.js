// Podcast Studio: a branded shell around VDO.Ninja (served from ./app/),
// driven through its iframe postMessage API.
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
$('name').value = params.get('name') || localStorage.getItem('studio-name') || '';

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
  localStorage.setItem('studio-name', name);
  const camLabel = $('cam').selectedOptions[0]?.text;
  const micLabel = $('mic').selectedOptions[0]?.text;
  stopPreview();
  enterStudio(name, camLabel, micLabel);
};

/* ---------------- Studio ---------------- */
const vdo = $('vdo');
const send = msg => vdo.contentWindow?.postMessage(msg, '*');
const peers = new Set();
let micOn = true, camOn = true, recording = false, recStart = 0, recTimer;

function enterStudio(name, camLabel, micLabel) {
  $('greenRoom').hidden = true;
  $('studio').hidden = false;
  $('topShow').textContent = show;
  $('inviteBtn').hidden = $('recBtn').hidden = $('recSep').hidden = !isHost;

  const id = (name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'guest') + Math.random().toString(36).slice(2, 6);
  const q = new URLSearchParams({
    room, push: id, label: name,
    videodevice: camLabel || '1', audiodevice: micLabel || '1',
    quality: '0',           // 1080p
    record: '6000',         // local recording bitrate (kbps), triggered by the host
    css: new URL('vdo.css', location.href).href,
  });
  if (password) q.set('password', password);
  if (wss) q.set('wss', wss);
  // Flags without values
  const flags = ['autostart', 'webcam', 'showlabels', 'hideheader', 'nosettings'];
  vdo.src = 'app/?' + q + '&' + flags.join('&');
}

addEventListener('message', e => {
  if (e.source !== vdo.contentWindow || !e.data) return;
  const d = e.data;

  // Recording commands from the host arrive as generic P2P data
  if (d.dataReceived?.studio) {
    const s = d.dataReceived.studio;
    if ('rec' in s && !isHost) setRecording(s.rec, s.since);
    return;
  }

  switch (d.action) {
    case 'view-connection':
      if (d.value) {
        peers.add(d.UUID);
        // Bring late joiners into an in-progress recording
        if (isHost && recording) send({ sendData: { studio: { rec: true, since: recStart } }, UUID: d.UUID });
      } else peers.delete(d.UUID);
      break;
    case 'end-view-connection':
      peers.delete(d.UUID);
      break;
    case 'recording-stopped':
      if (recording && !isHost) toast('Recording saved to your Downloads');
      break;
  }
  const n = peers.size + 1;
  $('people').textContent = `${n} in studio`;
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
  send({ record: on });
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
    toast(isHost ? 'Recording started on everyone\'s computer' : 'The host started recording');
  } else {
    toast(isHost ? 'Recording stopped. Files are saving to each person\'s Downloads' : 'Recording stopped. Your file is in Downloads');
  }
}

$('recBtn').onclick = () => {
  const on = !recording;
  setRecording(on);
  send({ sendData: { studio: { rec: on, since: recStart } } });
};

$('leaveBtn').onclick = () => {
  if (recording && !confirm('Recording is still running. Leave anyway?')) return;
  const wasRecording = recording;
  if (recording) { if (isHost) send({ sendData: { studio: { rec: false } } }); setRecording(false); }
  setTimeout(() => {
    send({ hangup: true });
    vdo.src = 'about:blank';
    $('studio').hidden = true;
    $('done').hidden = false;
    if (isHost) $('doneMsg').textContent = 'Your recording is in your Downloads folder. Collect the guest files and run scripts/normalize.sh.';
  }, wasRecording ? 1500 : 0);
};

addEventListener('beforeunload', e => { if (recording) e.preventDefault(); });

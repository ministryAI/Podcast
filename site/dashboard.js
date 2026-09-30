// Dashboard: start sessions and browse the local recording library (all stored in OPFS).
import { listSessions, readMeta, updateMeta, deleteSession, getFile, usage, persist, fmtBytes, fmtDur } from './lib/store.js';
import { QUALITY } from './lib/recording.js';

const $ = id => document.getElementById(id);
const view = $('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urls = [];
const objURL = b => { const u = URL.createObjectURL(b); urls.push(u); return u; };

const prefs = (() => { try { return JSON.parse(localStorage.getItem('studio-prefs') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('studio-prefs', JSON.stringify(prefs)); localStorage.setItem('studio-name', prefs.name || ''); } catch {} };
if (!prefs.name) try { prefs.name = localStorage.getItem('studio-name') || ''; } catch {}

const toast = msg => {
  $('toast').textContent = msg; $('toast').classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => $('toast').classList.remove('show'), 2200);
};
const when = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const sessionDuration = m => (m.takes || []).reduce((a, t) => a + (t.duration || 0), 0);

async function thumbURL(m) {
  if (!m.thumb) return '';
  try { return objURL(await getFile(m.id, m.thumb)); } catch { return ''; }
}

async function card(m) {
  const t = await thumbURL(m);
  const people = new Set((m.tracks || []).map(t => t.name)).size;
  return `<a class="rcard" href="#/session/${encodeURIComponent(m.id)}">
    <div class="thumb" style="${t ? `background-image:url(${t})` : ''}">${t ? '' : '🎙️'}
      <span class="badge">${(m.takes || []).length} take${(m.takes || []).length === 1 ? '' : 's'}</span>
      <span class="dur">${fmtDur(sessionDuration(m))}</span></div>
    <div class="info"><b>${esc(m.show || 'Untitled')}</b><span class="mut small">${when(m.created)} · ${people} ${people === 1 ? 'person' : 'people'}</span></div>
  </a>`;
}

/* ---------------- pages ---------------- */
async function home() {
  const sessions = await listSessions();
  view.innerHTML = `
    <h1 class="hero">What do you want to create${prefs.name ? ', ' + esc(prefs.name.split(' ')[0]) : ''}?</h1>
    ${newForm()}
    <div class="cards">
      <a class="qcard" href="#/new"><span class="qi rec-ic">●</span><div><b>Record</b><span>Start a new recording</span></div></a>
      <a class="qcard" href="#/recordings"><span class="qi">▤</span><div><b>Recordings</b><span>${sessions.length} saved on this device</span></div></a>
      <a class="qcard" href="tools/"><span class="qi">⧉</span><div><b>Live / OBS</b><span>Links for OBS scenes</span></div></a>
      <a class="qcard" href="#/settings"><span class="qi">⚙</span><div><b>Settings</b><span>Name, quality, storage</span></div></a>
    </div>
    <div class="section-h"><h2>Recents</h2>${sessions.length > 6 ? '<a href="#/recordings" class="mut">View all →</a>' : ''}</div>
    ${sessions.length ? `<div class="grid">${(await Promise.all(sessions.slice(0, 6).map(card))).join('')}</div>`
      : '<div class="empty">No recordings yet. Start one above and it shows up here.</div>'}`;
  bindNewForm();
}

function newForm() {
  const q = prefs.quality || '720';
  return `<form class="create" id="newForm">
    <div class="row">
      <label class="field"><span>Show / episode name</span><input id="nfShow" required placeholder="Episode 12: Special guest" value="${esc(prefs.show || '')}"></label>
      <label class="field"><span>Your name</span><input id="nfName" required placeholder="Host" value="${esc(prefs.name || '')}"></label>
    </div>
    <div class="row">
      <label class="field"><span>Recording quality</span><select id="nfQuality">${Object.entries(QUALITY).map(([k, v]) => `<option value="${k}" ${k === q ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="field"><span>Password (optional)</span><input id="nfPw" placeholder="Keeps uninvited people out"></label>
    </div>
    <div class="actions"><span class="mut small">Everyone records in high quality on their own computer. Files come straight to this device.</span>
      <button class="btn">● Start recording session</button></div>
  </form>`;
}

function bindNewForm() {
  $('newForm').onsubmit = async e => {
    e.preventDefault();
    const show = $('nfShow').value.trim(), name = $('nfName').value.trim(), quality = $('nfQuality').value;
    Object.assign(prefs, { name, quality }); prefs.show = ''; savePrefs();
    await persist();
    const room = (show.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'show') + Math.random().toString(36).slice(2, 8);
    await updateMeta(room, m => Object.assign(m, { show, host: name, quality, password: $('nfPw').value }));
    openStudio(room, show, name, $('nfPw').value);
  };
}

function openStudio(room, show, name, pw) {
  const q = new URLSearchParams({ room, show, name, host: '1' });
  if (pw) q.set('pw', pw);
  location.href = 'studio.html?' + q;
}

async function newPage() {
  view.innerHTML = `<h1 class="page-title">New recording</h1>${newForm()}`;
  bindNewForm();
  $('nfShow').focus();
}

async function recordings() {
  const sessions = await listSessions();
  view.innerHTML = `<div class="section-h"><h1 class="page-title" style="margin:0">Recordings</h1>
      <input id="search" class="search" placeholder="Search…" style="padding:10px 14px;border-radius:10px;background:var(--panel);border:1px solid var(--line);color:var(--fg)"></div>
    <div id="list"></div>`;
  const render = async term => {
    const list = sessions.filter(m => !term || (m.show || '').toLowerCase().includes(term.toLowerCase()));
    $('list').innerHTML = list.length ? `<div class="grid">${(await Promise.all(list.map(card))).join('')}</div>` : '<div class="empty">Nothing here yet.</div>';
  };
  $('search').oninput = e => render(e.target.value);
  render('');
}

async function session(id) {
  const m = await readMeta(id);
  if (!m) { view.innerHTML = '<div class="empty">Recording not found on this device.</div>'; return; }
  const takes = [...(m.takes || [])].sort((a, b) => a.n - b.n);
  let total = 0;
  const sections = await Promise.all(takes.map(async tk => {
    const tracks = (m.tracks || []).filter(t => t.take === tk.n);
    const cards = await Promise.all(tracks.map(async t => {
      let src = '', size = t.bytes || 0;
      try { const f = await getFile(id, t.file); size = f.size; src = objURL(f); } catch {}
      total += size;
      const audioOnly = m.quality === 'audio';
      return `<div class="track">
        ${src ? (audioOnly ? `<audio controls preload="metadata" src="${src}"></audio>` : `<video controls preload="metadata" src="${src}"></video>`) : '<div class="thumb">…</div>'}
        <div class="meta"><div><b>${esc(t.name)}</b> <span class="mut small">${t.role === 'host' ? 'Host' : 'Guest'} · ${fmtBytes(size)}</span></div>
          <div class="btns"><span class="status ${esc(t.status)}">${esc(t.status)}</span>
          ${src ? `<a class="btn ghost sm" download="${esc(m.show)}-${esc(t.file)}" href="${src}">Export</a>` : ''}</div></div>
      </div>`;
    }));
    return `<section class="take"><h3>Take ${tk.n} · ${when(tk.started)} · ${fmtDur(tk.duration)}</h3>
      <div class="tracks">${cards.join('') || '<div class="empty">No tracks</div>'}</div></section>`;
  }));
  view.innerHTML = `
    <a href="#/recordings" class="mut small">← All recordings</a>
    <div class="detail-head" style="margin-top:10px">
      <div><h1 contenteditable="true" id="title" spellcheck="false">${esc(m.show || 'Untitled')}</h1>
        <div class="mut">${when(m.created)} · ${takes.length} take${takes.length === 1 ? '' : 's'} · ${fmtBytes(total)}</div></div>
      <div class="btns">
        <button class="btn sm" id="resume">● Record another take</button>
        <button class="btn ghost sm" id="invite">🔗 Guest link</button>
        <button class="btn danger sm" id="del">Delete</button>
      </div>
    </div>
    ${sections.join('') || '<div class="empty">No takes recorded yet. Hit "Record another take" to go back into the studio.</div>'}`;

  $('title').onblur = () => updateMeta(id, x => { x.show = $('title').textContent.trim() || 'Untitled'; });
  $('title').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('resume').onclick = () => openStudio(id, m.show, prefs.name || m.host || 'Host', m.password);
  $('invite').onclick = async () => {
    const q = new URLSearchParams({ room: id, show: m.show });
    if (m.password) q.set('pw', m.password);
    const link = new URL('studio.html?' + q, location.href).href;
    try { await navigator.clipboard.writeText(link); toast('Guest link copied'); } catch { prompt('Guest link:', link); }
  };
  $('del').onclick = async () => {
    if (!confirm(`Delete "${m.show}" and all its files from this device? This can't be undone.`)) return;
    await deleteSession(id); toast('Deleted'); location.hash = '#/recordings';
  };
}

async function settings() {
  const u = await usage();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const pct = u.quota ? Math.min(100, (u.usage / u.quota) * 100) : 0;
  view.innerHTML = `<h1 class="page-title">Settings</h1>
    <form class="settings card" id="setForm">
      <label class="field"><span>Your name</span><input id="sName" value="${esc(prefs.name || '')}"></label>
      <label class="field"><span>Default recording quality</span><select id="sQuality">${Object.entries(QUALITY).map(([k, v]) => `<option value="${k}" ${k === (prefs.quality || '720') ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <button class="btn">Save</button>
    </form>
    <div class="settings card" style="margin-top:16px">
      <b>Storage on this device</b>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="mut small">${fmtBytes(u.usage || 0)} used of ${fmtBytes(u.quota || 0)} available to this site.
        ${persisted ? '✓ Protected from automatic cleanup.' : '⚠ The browser may clear this if disk space runs low.'}</div>
      ${persisted ? '' : '<button class="btn ghost sm" id="persistBtn" style="margin-top:12px">Protect my recordings</button>'}
      <p class="mut small">Recordings live in this browser's private storage. Clearing site data for this site deletes them, so export anything important.</p>
    </div>`;
  $('setForm').onsubmit = e => {
    e.preventDefault();
    prefs.name = $('sName').value.trim(); prefs.quality = $('sQuality').value; savePrefs(); sideInfo(); toast('Saved');
  };
  const pb = $('persistBtn');
  if (pb) pb.onclick = async () => { toast((await persist()) ? 'Recordings protected' : 'Your browser declined. Try bookmarking this site first'); settings(); };
}

/* ---------------- shell ---------------- */
async function sideInfo() {
  $('sideName').textContent = prefs.name || 'You';
  $('avatar').textContent = (prefs.name || '?')[0].toUpperCase();
  const u = await usage();
  $('sideStorage').textContent = u.usage != null ? fmtBytes(u.usage) + ' stored' : '';
}

async function route() {
  urls.splice(0).forEach(URL.revokeObjectURL);
  const [, page = '', arg] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (page || 'home') || (page === 'session' && a.dataset.nav === 'recordings')));
  $('side').classList.remove('open');
  if (page === 'recordings') await recordings();
  else if (page === 'session') await session(decodeURIComponent(arg || ''));
  else if (page === 'settings') await settings();
  else if (page === 'new') await newPage();
  else await home();
  window.scrollTo(0, 0);
}

$('menuBtn').onclick = () => $('side').classList.toggle('open');
addEventListener('hashchange', route);
sideInfo();
route();

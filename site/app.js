// Builds VDO.Ninja director, guest and OBS links for one episode.
const $ = id => document.getElementById(id);
const FIELDS = ['show', 'room', 'password', 'server', 'turn', 'guests'];

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'guest';
const rand = () => Math.random().toString(36).slice(2, 8);

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem('studio') || '{}');
    FIELDS.forEach(f => { if (saved[f] != null) $(f).value = saved[f]; });
    if (saved.record != null) $('record').checked = saved.record;
  } catch {}
}
function save() {
  try {
    const data = Object.fromEntries(FIELDS.map(f => [f, $(f).value]));
    data.record = $('record').checked;
    localStorage.setItem('studio', JSON.stringify(data));
  } catch {}
}

function url(params) {
  const base = $('server').value.replace(/\/+$/, '') + '/';
  const q = Object.entries(params)
    .filter(([, v]) => v !== false && v != null && v !== '')
    .map(([k, v]) => v === true ? k : `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return base + '?' + q;
}

function row(label, href) {
  const d = document.createElement('div');
  d.className = 'link';
  d.innerHTML = `<b></b><code></code><button>Copy</button>`;
  d.querySelector('b').textContent = label;
  d.querySelector('code').textContent = href;
  d.querySelector('button').onclick = e => {
    navigator.clipboard.writeText(href);
    e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy', 1200);
  };
  return d;
}

$('go').onclick = () => {
  if (!$('room').value) $('room').value = slug($('show').value) + rand();
  save();
  const common = { room: $('room').value, password: $('password').value, turn: $('turn').value };
  const names = $('guests').value.split('\n').map(s => s.trim()).filter(Boolean);

  $('director').replaceChildren(row('Director', url({ ...common, director: true })));
  $('guestLinks').replaceChildren(...names.map(n => row(n, url({
    ...common, push: slug(n) + '_' + $('room').value.slice(-4), label: n,
    // proaudio: disables echo cancel/AGC and raises bitrate. Guests MUST wear headphones.
    proaudio: true, quality: 0, webcam: true, record: $('record').checked ? true : false,
  }))));
  $('obsLinks').replaceChildren(...names.map(n => row(n, url({
    ...common, view: slug(n) + '_' + $('room').value.slice(-4),
    solo: true, cleanoutput: true, proaudio: true,
  }))));
  $('out').hidden = false;
};

load();

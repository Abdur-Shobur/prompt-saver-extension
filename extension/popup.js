const $ = (s) => document.querySelector(s);
const send = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};
const SITE_LABEL = { chatgpt: 'ChatGPT', claude: 'Claude' };
const PAGE = 150;

const state = {
  prompts: [], auth: null, settings: {}, filter: 'all', q: '', limit: PAGE,
  expanded: new Set(), lastSyncAt: 0, syncError: '', lastBackupAt: 0
};

if (new URLSearchParams(location.search).has('full')) {
  document.body.classList.add('full');
  $('#openFull').hidden = true;
}

// ---------- data ----------
async function load() {
  const d = await chrome.storage.local.get(['prompts', 'auth', 'settings', 'lastSyncAt', 'syncError', 'lastBackupAt']);
  state.prompts = (d.prompts || []).filter((p) => !p.deleted);
  state.auth = d.auth?.token ? d.auth : null;
  state.settings = {
    autoBackup: true, ...(d.settings || {}),
    sites: { chatgpt: true, claude: true, ...(d.settings?.sites || {}) }
  };
  state.lastSyncAt = d.lastSyncAt || 0;
  state.syncError = d.syncError || '';
  state.lastBackupAt = d.lastBackupAt || 0;
  renderList();
  renderSettings();
}

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') load(); });

// ---------- helpers ----------
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) +
      ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function ago(ms) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(ms).toLocaleString();
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
}
function setMsg(el, text, kind = '') {
  el.textContent = text || '';
  el.className = 'msg ' + kind;
}
function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.prompts.filter((p) => {
    if (state.filter === 'fav' && !p.favorite) return false;
    if ((state.filter === 'chatgpt' || state.filter === 'claude') && p.site !== state.filter) return false;
    if (q && !(p.text.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

// ---------- render: list ----------
function renderList() {
  const list = $('#list');
  const items = filtered();
  list.replaceChildren();

  $('#empty').hidden = state.prompts.length > 0;
  $('#count').textContent = items.length === state.prompts.length
    ? `${state.prompts.length} prompts`
    : `${items.length} of ${state.prompts.length}`;

  for (const p of items.slice(0, state.limit)) list.appendChild(card(p));

  if (items.length > state.limit) {
    const more = document.createElement('button');
    more.className = 'btn small more';
    more.textContent = `Show more (${items.length - state.limit})`;
    more.onclick = () => { state.limit += PAGE; renderList(); };
    list.appendChild(more);
  }
}

function card(p) {
  const el = document.createElement('div');
  el.className = 'item';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const badge = document.createElement('span');
  badge.className = 'badge ' + p.site;
  badge.textContent = SITE_LABEL[p.site] || p.site;
  const date = document.createElement('span');
  date.textContent = fmtDate(p.createdAt);
  meta.append(badge, date);
  if (state.auth) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (p.synced ? ' synced' : '');
    dot.title = p.synced ? 'Synced to server' : 'Waiting to sync';
    meta.append(dot);
  }

  const text = document.createElement('div');
  text.className = 'text' + (state.expanded.has(p.id) ? '' : ' clamp');
  text.textContent = p.text;
  text.title = 'Click to expand';
  text.onclick = () => {
    state.expanded.has(p.id) ? state.expanded.delete(p.id) : state.expanded.add(p.id);
    text.classList.toggle('clamp');
  };

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    btn(ICONS.copy + 'Copy', 'Copy prompt', async () => {
      await navigator.clipboard.writeText(p.text);
      toast('Copied');
    }),
    btn(ICONS.star, p.favorite ? 'Unstar' : 'Star', () => send('UPDATE_PROMPT', { id: p.id, patch: { favorite: !p.favorite } }), p.favorite ? 'starred' : ''),
    p.url ? btn(ICONS.open, 'Open the chat it came from', () => chrome.tabs.create({ url: p.url })) : '',
    btn(ICONS.del, 'Delete', () => { if (confirm('Delete this prompt?')) send('DELETE_PROMPT', { id: p.id }); }, 'del')
  );

  el.append(meta, text, actions);
  return el;
}

function btn(html, title, onClick, cls = '') {
  const b = document.createElement('button');
  b.innerHTML = html;          // static icon markup only
  b.title = title;
  b.setAttribute('aria-label', title);
  if (cls) b.className = cls;
  b.onclick = onClick;
  return b;
}

// ---------- render: settings ----------
function renderSettings() {
  const a = state.auth;
  $('#loggedOut').hidden = !!a;
  $('#loggedIn').hidden = !a;

  const pill = $('#syncPill');
  if (a) {
    $('#whoami').textContent = a.email;
    $('#serverInfo').textContent = a.serverUrl;
    $('#lastSync').textContent = 'Last sync: ' + ago(state.lastSyncAt);
    pill.textContent = state.syncError ? 'Sync error' : 'Synced';
    pill.className = 'pill ' + (state.syncError ? 'err' : 'on');
    pill.title = state.syncError || 'Last sync: ' + ago(state.lastSyncAt);
  } else {
    pill.textContent = 'Local only';
    pill.className = 'pill';
    pill.title = 'Saved in this browser only';
  }

  $('#autoBackup').checked = !!state.settings.autoBackup;
  $('#siteChatgpt').checked = !!state.settings.sites.chatgpt;
  $('#siteClaude').checked = !!state.settings.sites.claude;
  $('#lastBackup').textContent = 'Last backup file: ' + ago(state.lastBackupAt);
}

// ---------- events ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#tab-prompts').hidden = t.dataset.tab !== 'prompts';
  $('#tab-settings').hidden = t.dataset.tab !== 'settings';
}));

document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
  state.filter = c.dataset.filter;
  state.limit = PAGE;
  renderList();
}));

$('#search').addEventListener('input', (e) => { state.q = e.target.value; state.limit = PAGE; renderList(); });

$('#openFull').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?full=1') });

$('#exportJson').onclick = () => {
  const data = { app: 'prompt-saver', version: 1, exportedAt: new Date().toISOString(), count: state.prompts.length,
    prompts: state.prompts.map(({ synced, deleted, ...rest }) => rest) };
  download(`prompts-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
};

$('#exportMd').onclick = () => {
  const lines = [`# Saved prompts — ${new Date().toLocaleString()}`, ''];
  state.prompts.forEach((p, i) => {
    lines.push(`## ${i + 1}. ${SITE_LABEL[p.site] || p.site} · ${new Date(p.createdAt).toLocaleString()}${p.favorite ? ' ★' : ''}`);
    if (p.url) lines.push(`<${p.url}>`);
    lines.push('', p.text, '', '---', '');
  });
  download(`prompts-${new Date().toISOString().slice(0, 10)}.md`, lines.join('\n'), 'text/markdown');
};

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const prompts = Array.isArray(data) ? data : data.prompts;
    const r = await send('IMPORT', { prompts });
    if (!r?.ok) throw new Error(r?.error || 'Import failed');
    toast(`Imported ${r.added} prompts`);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});

async function doAuth(register) {
  const msg = $('#authMsg');
  const serverUrl = $('#serverUrl').value.trim();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!serverUrl || !email || password.length < 6) {
    setMsg(msg, 'Enter server URL, email and a password (6+ characters).', 'error');
    return;
  }
  $('#loginBtn').disabled = $('#registerBtn').disabled = true;
  setMsg(msg, register ? 'Creating account…' : 'Logging in…');
  const r = await send('LOGIN', { serverUrl, email, password, register });
  $('#loginBtn').disabled = $('#registerBtn').disabled = false;
  if (r?.ok) {
    $('#password').value = '';
    setMsg(msg, 'Logged in. Your prompts are syncing.', 'ok');
  } else {
    setMsg(msg, r?.error || 'Could not log in.', 'error');
  }
}
$('#loginBtn').onclick = () => doAuth(false);
$('#registerBtn').onclick = () => doAuth(true);

$('#logoutBtn').onclick = async () => {
  await send('LOGOUT');
  setMsg($('#authMsg'), 'Logged out. Prompts stay saved on this PC.', 'ok');
};

$('#syncBtn').onclick = async () => {
  $('#syncBtn').disabled = true;
  setMsg($('#authMsg'), 'Syncing…');
  const r = await send('SYNC_NOW');
  $('#syncBtn').disabled = false;
  setMsg($('#authMsg'), r?.ok ? 'Sync complete.' : (r?.error || 'Sync failed.'), r?.ok ? 'ok' : 'error');
};

$('#backupBtn').onclick = async () => {
  $('#backupBtn').disabled = true;
  const r = await send('BACKUP_NOW');
  $('#backupBtn').disabled = false;
  setMsg($('#backupMsg'), r?.ok ? `Saved ${r.count} prompts to Downloads/${r.file}` : (r?.error || 'Backup failed.'), r?.ok ? 'ok' : 'error');
};

$('#autoBackup').onchange = (e) => send('SET_SETTINGS', { settings: { autoBackup: e.target.checked } });
$('#siteChatgpt').onchange = (e) => send('SET_SETTINGS', { settings: { sites: { chatgpt: e.target.checked } } });
$('#siteClaude').onchange = (e) => send('SET_SETTINGS', { settings: { sites: { claude: e.target.checked } } });

// Prefill last-used server URL
chrome.storage.local.get('lastServerUrl').then(({ lastServerUrl }) => {
  if (lastServerUrl && !$('#serverUrl').value) $('#serverUrl').value = lastServerUrl;
});
$('#serverUrl').addEventListener('change', (e) => chrome.storage.local.set({ lastServerUrl: e.target.value.trim() }));

load();

// Prompt Saver — background service worker
// Local storage is always the source of truth on this PC.
// If the user is logged in, changes are pushed to / pulled from the sync server.

const DEFAULT_SETTINGS = {
  sites: { chatgpt: true, claude: true },
  autoBackup: true            // daily backup file in Downloads/PromptSaver/
};

const SYNC_ALARM = 'ps-sync';
const BACKUP_ALARM = 'ps-backup';
const BACKUP_FILE = 'PromptSaver/prompts-backup.json';

// ---------- storage helpers ----------
let chain = Promise.resolve();
function locked(fn) {               // serialize read-modify-write on storage
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

const store = chrome.storage.local;

async function getSettings() {
  const { settings } = await store.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    sites: { ...DEFAULT_SETTINGS.sites, ...(settings?.sites || {}) }
  };
}

async function getAuth() {
  const { auth } = await store.get('auth');
  return auth?.token ? auth : null;
}

async function getPrompts() {
  const { prompts } = await store.get('prompts');
  return Array.isArray(prompts) ? prompts : [];
}

const toWire = (p) => ({
  id: p.id, text: p.text || '', site: p.site || '', url: p.url || '', title: p.title || '',
  favorite: !!p.favorite, deleted: !!p.deleted, createdAt: p.createdAt, updatedAt: p.updatedAt
});

// ---------- prompt operations ----------
async function savePrompt(p) {
  const settings = await getSettings();
  const site = p?.site === 'claude' ? 'claude' : 'chatgpt';
  if (!settings.sites[site]) return { skipped: true };
  const text = String(p?.text || '').trim().slice(0, 200000);
  if (!text) return { skipped: true };

  const result = await locked(async () => {
    const prompts = await getPrompts();
    const now = Date.now();
    const dupe = prompts.find(x => !x.deleted && x.site === site && x.text === text && now - x.createdAt < 10000);
    if (dupe) return { duplicate: true };
    const item = {
      id: crypto.randomUUID(), text, site,
      url: String(p.url || '').slice(0, 2000), title: String(p.title || '').slice(0, 300),
      favorite: false, deleted: false, createdAt: now, updatedAt: now, synced: false
    };
    prompts.unshift(item);
    await store.set({ prompts });
    return { saved: true, id: item.id };
  });

  if (result.saved) {
    flashBadge();
    sync().catch(() => {});
  }
  return result;
}

async function updatePrompt(id, patch = {}) {
  await locked(async () => {
    const prompts = await getPrompts();
    const p = prompts.find(x => x.id === id);
    if (!p) return;
    if ('favorite' in patch) p.favorite = !!patch.favorite;
    if (typeof patch.text === 'string' && patch.text.trim()) p.text = patch.text.trim();
    p.updatedAt = Date.now();
    p.synced = false;
    await store.set({ prompts });
  });
  sync().catch(() => {});
}

async function deletePrompt(id) {
  await locked(async () => {
    const prompts = await getPrompts();
    const i = prompts.findIndex(x => x.id === id);
    if (i < 0) return;
    // Keep a tiny tombstone (no text) so the delete reaches the server too.
    prompts[i] = { id, deleted: true, text: '', createdAt: prompts[i].createdAt, updatedAt: Date.now(), synced: false };
    await store.set({ prompts });
  });
  sync().catch(() => {});
}

async function importPrompts(list) {
  if (!Array.isArray(list)) throw new Error('File has no prompts list.');
  let added = 0;
  await locked(async () => {
    const prompts = await getPrompts();
    const ids = new Set(prompts.map(p => p.id));
    const keys = new Set(prompts.map(p => p.text + '|' + p.createdAt));
    const now = Date.now();
    for (const r of list) {
      const text = String(r?.text || '').trim();
      if (!text) continue;
      const createdAt = Number(r.createdAt) || Date.parse(r.createdAt) || now;
      if ((r.id && ids.has(r.id)) || keys.has(text + '|' + createdAt)) continue;
      const id = r.id && typeof r.id === 'string' ? r.id : crypto.randomUUID();
      prompts.push({
        id, text, site: r.site === 'claude' ? 'claude' : 'chatgpt', url: r.url || '', title: r.title || '',
        favorite: !!r.favorite, deleted: false, createdAt, updatedAt: now, synced: false
      });
      ids.add(id); keys.add(text + '|' + createdAt); added++;
    }
    prompts.sort((a, b) => b.createdAt - a.createdAt);
    await store.set({ prompts });
  });
  sync().catch(() => {});
  return { added };
}

// ---------- server sync ----------
async function api(baseUrl, path, body, token) {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    await store.remove('auth');
    throw new Error('Session expired — please log in again.');
  }
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

const encoder = new TextEncoder();
function chunkBySize(items, maxBytes = 2_500_000, maxItems = 800) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const it of items) {
    const s = encoder.encode(JSON.stringify(it)).length;
    if (cur.length && (size + s > maxBytes || cur.length >= maxItems)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

let syncing = null;
let again = false;
function sync() {
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    try {
      do { again = false; await doSync(); } while (again);
    } catch (e) {
      await store.set({ syncError: e.message || String(e) });
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function doSync() {
  const auth = await getAuth();
  if (!auth) return;
  const { syncCursor = 0 } = await store.get('syncCursor');

  const dirty = (await getPrompts()).filter(p => !p.synced);
  const sent = new Map(dirty.map(p => [p.id, p.updatedAt]));

  // Push in chunks — Vercel limits request bodies to ~4.5 MB.
  const chunks = chunkBySize(dirty.map(toWire));
  for (let i = 0; i < chunks.length - 1; i++) {
    await api(auth.serverUrl, '/api/sync', { prompts: chunks[i], pull: false }, auth.token);
  }

  // Last chunk + pull everything changed since our cursor (paged).
  let body = { since: syncCursor, prompts: chunks[chunks.length - 1] || [] };
  let since = null;
  const changes = [];
  for (let i = 0; i < 1000; i++) {
    const res = await api(auth.serverUrl, '/api/sync', body, auth.token);
    if (since === null) since = res.now;
    changes.push(...(res.changes || []));
    if (!res.more || !res.after) break;
    body = { since: syncCursor, after: res.after, prompts: [] };
  }

  await locked(async () => {
    const list = await getPrompts();
    const byId = new Map(list.map(p => [p.id, p]));
    for (const p of list) if (sent.get(p.id) === p.updatedAt) p.synced = true;
    for (const r of changes) {
      const local = byId.get(r.id);
      if (local && local.updatedAt > r.updatedAt) continue; // local edit is newer
      byId.set(r.id, { ...r, synced: true });
    }
    const merged = [...byId.values()]
      .filter(p => !(p.deleted && p.synced))
      .sort((a, b) => b.createdAt - a.createdAt);
    await store.set({ prompts: merged, syncCursor: since, lastSyncAt: Date.now(), syncError: '' });
  });
}

async function login({ serverUrl, email, password, register }) {
  serverUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(serverUrl)) throw new Error('Server URL must start with https://');
  const data = await api(serverUrl, register ? '/api/register' : '/api/login', { email, password });
  await locked(async () => {
    const prompts = await getPrompts();
    prompts.forEach(p => { p.synced = false; });   // upload everything saved offline
    await store.set({ auth: { serverUrl, token: data.token, email: data.email }, syncCursor: 0, prompts, syncError: '' });
  });
  await sync();
  return { email: data.email };
}

async function logout() {
  await store.remove(['auth', 'syncCursor', 'syncError']);
}

// ---------- backup to PC (Downloads/PromptSaver/) ----------
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Create a backup file of saved prompts on this computer'
    });
  } catch (e) {
    if (!String(e?.message).includes('single offscreen')) throw e;
  }
}

async function backupToPC() {
  const prompts = (await getPrompts()).filter(p => !p.deleted);
  const json = JSON.stringify({
    app: 'prompt-saver', version: 1, exportedAt: new Date().toISOString(),
    count: prompts.length,
    prompts: prompts.map(({ synced, deleted, ...rest }) => rest)
  }, null, 2);
  await ensureOffscreen();
  const { url } = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_BLOB', data: json, mime: 'application/json' });
  await chrome.downloads.download({ url, filename: BACKUP_FILE, conflictAction: 'overwrite', saveAs: false });
  await store.set({ lastBackupAt: Date.now() });
  return { file: BACKUP_FILE, count: prompts.length };
}

// ---------- settings ----------
async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, sites: { ...cur.sites, ...(patch?.sites || {}) } };
  await store.set({ settings: next });
  return { settings: next };
}

// ---------- badge ----------
function flashBadge() {
  chrome.action.setBadgeBackgroundColor({ color: '#10a37f' });
  chrome.action.setBadgeText({ text: '✓' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

// ---------- alarms ----------
function setupAlarms() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  chrome.alarms.create(BACKUP_ALARM, { periodInMinutes: 24 * 60 });
}
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(() => { setupAlarms(); sync().catch(() => {}); });

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === SYNC_ALARM) sync().catch(() => {});
  if (a.name === BACKUP_ALARM) {
    const s = await getSettings();
    if (s.autoBackup) backupToPC().catch(() => {});
  }
});

// ---------- messages ----------
const handlers = {
  SAVE_PROMPT: (m) => savePrompt(m.prompt),
  UPDATE_PROMPT: (m) => updatePrompt(m.id, m.patch),
  DELETE_PROMPT: (m) => deletePrompt(m.id),
  IMPORT: (m) => importPrompts(m.prompts),
  LOGIN: (m) => login(m),
  LOGOUT: () => logout(),
  SYNC_NOW: () => sync(),
  BACKUP_NOW: () => backupToPC(),
  SET_SETTINGS: (m) => setSettings(m.settings)
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg))
    .then((r) => sendResponse({ ok: true, ...(r || {}) }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});

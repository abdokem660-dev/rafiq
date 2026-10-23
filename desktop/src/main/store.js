/* Rafiq — local persistence (settings, sessions, recents). Plain JSON, no cloud. */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { uid, nowISO } = require('./util');

const DEFAULT_SETTINGS = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  apiKey: '',
  temperature: 0.2,
  maxTokens: 4096,
  theme: 'dark',
  lang: 'en',
  userName: '',
  requireCommandApproval: true,
  allowDangerousCommands: false,
  confirmFileChanges: false
};

function defaultDataDir() {
  if (process.env.RAFIQ_DATA_DIR) return process.env.RAFIQ_DATA_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'Rafiq');
  return path.join(os.homedir(), '.rafiq');
}

class Store {
  constructor({ dataDir, encrypt, decrypt } = {}) {
    this.dir = dataDir || defaultDataDir();
    this.sessionsDir = path.join(this.dir, 'sessions');
    this.encrypt = encrypt || null;
    this.decrypt = decrypt || null;
    fs.mkdirSync(this.sessionsDir, { recursive: true });

    this.settings = { ...DEFAULT_SETTINGS, ...this.readJson('settings.json', {}) };
    const state = this.readJson('state.json', {});
    this.state = { recent: [], lastWorkspace: null, ...state };

    // decrypt the API key if it was stored with OS protection
    if (this.settings.apiKeyEnc && this.decrypt) {
      try { this.settings.apiKey = this.decrypt(this.settings.apiKeyEnc) || ''; } catch { this.settings.apiKey = ''; }
    }
  }

  readJson(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')); }
    catch { return fallback; }
  }

  writeJson(name, value) {
    const file = path.join(this.dir, name);
    const tmp = file + '.tmp';
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  get(key) {
    if (key === 'settings') return this.settings;
    if (key === 'lastWorkspace') return this.state.lastWorkspace;
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    this.writeJson('state.json', this.state);
    return value;
  }

  addRecent(folder) {
    const recent = this.state.recent.filter((r) => r !== folder);
    recent.unshift(folder);
    this.state.recent = recent.slice(0, 8);
    this.writeJson('state.json', this.state);
    return this.state.recent;
  }

  patchSettings(patch) {
    const next = { ...this.settings, ...patch };
    next.temperature = Math.min(Math.max(Number(next.temperature) || 0.2, 0), 1.5);
    const toWrite = { ...next };
    if (this.encrypt && next.apiKey) {
      try {
        toWrite.apiKey = '';
        toWrite.apiKeyEnc = this.encrypt(next.apiKey);
      } catch { /* fall back to plaintext local file */ }
    }
    if (!next.apiKey) delete toWrite.apiKeyEnc;
    this.writeJson('settings.json', toWrite);
    this.settings = next;
    return this.settings;
  }

  /** Settings shaped for the renderer: never echo the key, just whether it exists. */
  publicSettings() {
    const { apiKey, apiKeyEnc, ...rest } = this.settings;
    return { ...rest, hasKey: Boolean(apiKey || apiKeyEnc) };
  }

  /* ── sessions ─────────────────────────────────────────────── */
  sessionFile(id) { return path.join(this.sessionsDir, id + '.json'); }

  saveSession(session) {
    if (!session?.id) return;
    const id = session.id;
    const existing = this.readJson(path.join('sessions', id + '.json'), null);
    this.writeJson(path.join('sessions', id + '.json'), {
      createdAt: existing?.createdAt || session.createdAt || nowISO(),
      ...session,
      id
    });
  }

  loadSession(id) {
    if (!/^[a-z0-9_]+$/i.test(id || '')) return null;
    return this.readJson(path.join('sessions', id + '.json'), null);
  }

  listSessions() {
    const out = [];
    let files = [];
    try { files = fs.readdirSync(this.sessionsDir); } catch { return out; }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const data = this.readJson(path.join('sessions', file), null);
      if (!data) continue;
      out.push({
        id: data.id,
        title: data.title || 'Session',
        updatedAt: data.updatedAt,
        mode: data.mode,
        workspace: data.workspace,
        count: (data.transcript || []).filter((t) => t.t === 'user').length
      });
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  deleteSession(id) {
    try { fs.unlinkSync(this.sessionFile(id)); return true; } catch { return false; }
  }

  newSessionMeta() {
    return { id: uid('s'), createdAt: nowISO() };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, defaultDataDir };

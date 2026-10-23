/*
 * Rafiq — local HTTP mode.
 * Runs the same agent in a plain Node process and serves the desktop UI in a
 * browser. Handy for headless use, LAN-free local access and development.
 * Binds to 127.0.0.1 only.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { Store } = require('./store');
const { Agent } = require('./agent');
const { PRESETS, listModels } = require('./providers');

const RENDERER = path.join(__dirname, '..', 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

function createRafiqServer({ port = 4123, host = '127.0.0.1', dataDir, workspace, token } = {}) {
  const store = new Store({ dataDir });
  const clients = new Set();
  const emit = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { /* dropped client */ }
    }
  };
  const agent = new Agent({ store, emit });

  if (workspace) {
    agent.workspace.setRoot(workspace).then(() => {
      store.set('lastWorkspace', agent.workspace.root);
      emit({ type: 'workspace', workspace: agent.workspace.info() });
    }).catch((err) => console.warn('[rafiq] workspace:', err.message));
  }

  const allowFrame = process.env.RAFIQ_ALLOW_FRAME === '1';
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    ...(allowFrame ? {} : { 'X-Frame-Options': 'SAMEORIGIN' }),
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${allowFrame ? '; frame-ancestors *' : ''}`
  };

  const json = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  };

  const readBody = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const route = url.pathname;

    // local-only CSRF guard: reject cross-origin state changes.
    // Hosts other than loopback (e.g. a sandbox preview proxy) must be allowed
    // explicitly with RAFIQ_ALLOW_FRAME=1.
    const origin = req.headers.origin;
    if (origin && /^https?:\/\//.test(origin)) {
      const hostHeader = req.headers.host || '';
      const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader);
      if (!origin.endsWith(hostHeader) && !(allowFrame && !loopback)) {
        json(res, 403, { error: 'Cross-origin request refused.' });
        return;
      }
    }
    if (token && route.startsWith('/api/') && url.searchParams.get('token') !== token) {
      json(res, 401, { error: 'Bad token' });
      return;
    }

    try {
      if (route === '/api/events') {
        res.writeHead(200, {
          ...securityHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write(`data: ${JSON.stringify({ type: 'hello', state: agent.state })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }

      if (route === '/api/state') {
        json(res, 200, {
          platform: process.platform,
          version: require('../../package.json').version,
          state: agent.state,
          settings: store.publicSettings(),
          presets: PRESETS,
          sessions: store.listSessions(),
          recents: store.get('recent') || [],
          home: os.homedir(),
          browser: true
        });
        return;
      }

      if (route === '/api/settings' && req.method === 'POST') {
        const body = await readBody(req);
        const settings = agent.setSettings(body || {});
        json(res, 200, { ok: true, settings });
        return;
      }

      if (route === '/api/workspace' && req.method === 'POST') {
        const body = await readBody(req);
        const info = await agent.openWorkspace(body.path);
        json(res, 200, { ok: true, workspace: info });
        return;
      }

      if (route === '/api/tree') {
        const rel = url.searchParams.get('path') || '';
        json(res, 200, { ok: true, nodes: await agent.workspace.tree(rel, 6) });
        return;
      }

      if (route === '/api/file' && req.method === 'POST') {
        const body = await readBody(req);
        await agent.recordBackup(body.path);
        json(res, 200, { ok: true, ...(await agent.workspace.write(body.path, body.content)) });
        return;
      }

      if (route === '/api/file') {
        const rel = url.searchParams.get('path') || '';
        json(res, 200, { ok: true, file: await agent.workspace.read(rel) });
        return;
      }

      if (route === '/api/models' && req.method === 'POST') {
        const body = await readBody(req);
        const key = body.apiKey || agent.settings.apiKey;
        const models = await listModels({ baseUrl: body.baseUrl || agent.settings.baseUrl, apiKey: key });
        json(res, 200, { ok: true, models });
        return;
      }

      if (route === '/api/session/new' && req.method === 'POST') {
        const state = agent.newSession();
        json(res, 200, { ok: true, state });
        return;
      }

      if (route === '/api/session/load' && req.method === 'POST') {
        const body = await readBody(req);
        const session = store.loadSession(body.id);
        if (!session) { json(res, 404, { error: 'Session not found' }); return; }
        json(res, 200, { ok: true, state: agent.loadSession(session), session });
        return;
      }

      if (route === '/api/session/delete' && req.method === 'POST') {
        const body = await readBody(req);
        json(res, 200, { ok: store.deleteSession(body.id), sessions: store.listSessions() });
        return;
      }

      if (route === '/api/session/current') {
        json(res, 200, { ok: true, session: agent.sessionId ? store.loadSession(agent.sessionId) : null });
        return;
      }

      if (route === '/api/chat' && req.method === 'POST') {
        const body = await readBody(req);
        json(res, 200, { ok: true });
        agent.send({ text: body.text, mode: body.mode, attachments: body.attachments || [] })
          .catch((err) => emit({ type: 'error', message: err.message }));
        return;
      }

      if (route === '/api/cancel' && req.method === 'POST') { agent.cancel(); json(res, 200, { ok: true }); return; }
      if (route === '/api/mode' && req.method === 'POST') { const b = await readBody(req); agent.setMode(b.mode); json(res, 200, { ok: true }); return; }
      if (route === '/api/approve' && req.method === 'POST') { const b = await readBody(req); json(res, 200, { ok: agent.resolveApproval(b.id, b.allow) }); return; }
      if (route === '/api/plan/approve' && req.method === 'POST') { const b = await readBody(req); agent.approvePlan(b.plan || ''); json(res, 200, { ok: true, state: agent.state }); return; }
      if (route === '/api/undo' && req.method === 'POST') { json(res, 200, { ok: true, ...(await agent.undoLastTurn()) }); return; }
      if (route === '/api/mode-state') { json(res, 200, agent.state); return; }

      // static renderer
      let filePath = route === '/' ? '/index.html' : route;
      const abs = path.join(RENDERER, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));
      if (!abs.startsWith(RENDERER)) { res.writeHead(403); res.end('Forbidden'); return; }
      fs.readFile(abs, (err, data) => {
        if (err) { res.writeHead(404, securityHeaders); res.end('Not found'); return; }
        res.writeHead(200, {
          ...securityHeaders,
          'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  return {
    server, agent, store,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      for (const res of clients) { try { res.end(); } catch {} }
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

if (require.main === module) {
  const port = Number(process.env.RAFIQ_PORT) || 4123;
  const host = process.env.RAFIQ_HOST || '127.0.0.1';
  const workspace = process.env.RAFIQ_WORKSPACE || process.cwd();
  const app = createRafiqServer({ port, host, workspace });
  app.listen().then(() => {
    console.log(`\n  Rafiq is running at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
    console.log(`  Workspace: ${workspace}\n`);
  }).catch((err) => {
    console.error('Could not start Rafiq:', err.message);
    process.exit(1);
  });
}

module.exports = { createRafiqServer };

/*
 * End-to-end test: a fake OpenAI-compatible provider drives the real agent
 * loop through the local HTTP server — no network, no API key needed.
 *   node test/e2e.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createRafiqServer } = require('../src/main/server');

const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

function startMockProvider() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      calls.push(payload);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const toolResults = (payload.messages || []).filter((m) => m.role === 'tool').length;

      if (toolResults === 0) {
        // step 1: ask to write a file
        sse(res, { choices: [{ delta: { content: 'Writing the file now.' } }] });
        sse(res, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_write',
                type: 'function',
                function: { name: 'write_file', arguments: JSON.stringify({ path: 'generated/hello.txt', content: 'hello from rafiq' }) }
              }]
            }
          }]
        });
        sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      } else if (toolResults === 1) {
        // step 2: run a benign command
        sse(res, {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_cmd',
                type: 'function',
                function: { name: 'run_command', arguments: JSON.stringify({ command: 'node -e "console.log(2+2)"' }) }
              }]
            }
          }]
        });
        sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        sse(res, { choices: [{ delta: { content: 'All done. I created **generated/hello.txt** and verified the command.' } }] });
        sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      }
      if (toolResults >= 2) sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port }));
  });
}

async function waitFor(events, predicate, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('Timed out waiting for event. Got: ' + events.map((e) => e.type).join(', '));
}

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-e2e-ws-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-e2e-data-'));
  fs.writeFileSync(path.join(workspace, 'index.js'), 'console.log("start");\n');

  const mock = await startMockProvider();
  const rafiq = createRafiqServer({ port: 0, dataDir, workspace });
  const address = await rafiq.listen();
  const base = `http://127.0.0.1:${address.port}`;

  const events = [];
  const sseRes = await fetch(base + '/api/events');
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = block.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(5).trim());
          events.push(event);
          if (event.type === 'approval') {
            await fetch(base + '/api/approve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: event.id, allow: true })
            });
          }
        } catch { /* ping */ }
      }
    }
  })().catch(() => {});

  const post = (route, payload) => fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  }).then((r) => r.json());

  const failures = [];
  const check = async (name, fn) => {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (err) { failures.push(name); console.log('  ✕ ' + name + '\n      ' + err.message); }
  };

  console.log('\nRafiq end-to-end (mock provider)');

  await check('serves the app and reports state', async () => {
    const page = await fetch(base + '/');
    assert.strictEqual(page.status, 200);
    assert.ok((await page.text()).includes('rafiq'));
    const state = await (await fetch(base + '/api/state')).json();
    assert.strictEqual(state.state.workspace.root, workspace);
    assert.strictEqual(state.browser, true);
    assert.ok(!JSON.stringify(state.settings).includes('apiKey'));
  });

  await check('saves provider settings', async () => {
    const res = await post('/api/settings', {
      provider: 'custom',
      baseUrl: `http://127.0.0.1:${mock.port}/v1`,
      model: 'mock-model',
      apiKey: 'test-key',
      requireCommandApproval: true,
      temperature: 0.1
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.settings.model, 'mock-model');
    assert.strictEqual(res.settings.hasKey, true);
    assert.ok(!('apiKey' in res.settings));
  });

  await check('builds files through the agent loop', async () => {
    await post('/api/mode', { mode: 'build' });
    await post('/api/chat', { text: 'Create generated/hello.txt', mode: 'build' });
    const turnEnd = await waitFor(events, (e) => e.type === 'turn:end');
    assert.ok(turnEnd);
    const file = path.join(workspace, 'generated', 'hello.txt');
    assert.ok(fs.existsSync(file), 'file should exist');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'hello from rafiq');
    assert.ok(events.some((e) => e.type === 'tool:start' && e.name === 'write_file'));
    assert.ok(events.some((e) => e.type === 'tool:end' && e.name === 'run_command' && e.ok), 'command should run after approval');
    assert.ok(events.some((e) => e.type === 'approval' && e.kind === 'command'));
    const final = events.filter((e) => e.type === 'assistant:end').pop();
    assert.ok(/All done/.test(final.content));
    assert.ok(mock.calls.length >= 3, 'provider should be called for each step');
  });

  await check('records the turn in a session on disk', async () => {
    const list = await (await fetch(base + '/api/state')).json();
    assert.ok(list.sessions.length >= 1);
    const current = await (await fetch(base + '/api/session/current')).json();
    assert.ok(current.session, 'session saved');
    assert.ok(current.session.transcript.some((t) => t.t === 'user'));
    assert.ok(current.session.transcript.some((t) => t.t === 'tool' && t.name === 'write_file'));
  });

  await check('undo restores the workspace', async () => {
    const res = await post('/api/undo');
    assert.strictEqual(res.ok, true);
    assert.ok(!fs.existsSync(path.join(workspace, 'generated', 'hello.txt')), 'file should be removed by undo');
  });

  await check('blocks path traversal from the API', async () => {
    const res = await fetch(base + '/api/file?path=' + encodeURIComponent('../secret.txt'));
    const data = await res.json();
    assert.ok(data.error, 'must return an error');
  });

  await check('rejects cross-origin state changes', async () => {
    const res = await fetch(base + '/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ model: 'evil' })
    });
    assert.strictEqual(res.status, 403);
  });

  mock.server.close();
  await rafiq.close();
  console.log(`\n${failures.length ? 'FAILED: ' + failures.join(', ') : 'Everything passed'}\n`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/* Rafiq desktop — dependency-free test suite (node test/run.js) */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ReadableStream } = require('stream/web');

const { Workspace, WorkspaceError } = require('../src/main/workspace');
const { screenCommand, runCommand } = require('../src/main/commands');
const { Store } = require('../src/main/store');
const { Agent } = require('../src/main/agent');
const { streamChat, ProviderError } = require('../src/main/providers');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓ ' + name);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log('  ✕ ' + name + '\n      ' + (err && err.message));
  }
}

function tmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-test-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'const a = 1;\nconsole.log(a);\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  fs.writeFileSync(path.join(dir, 'node_modules', 'junk', 'x.js'), 'ignore me');
  return dir;
}

(async () => {
  console.log('\nRafiq workspace');
  await test('rejects paths that escape the workspace', async () => {
    const dir = tmpWorkspace();
    const ws = new Workspace(dir);
    assert.throws(() => ws.resolve('../etc/passwd'), WorkspaceError);
    assert.throws(() => ws.resolve('src/../../outside.txt'), WorkspaceError);
    assert.throws(() => ws.resolve('C:\\Windows\\system32'), (e) => e.code === 'ABSOLUTE');
    assert.throws(() => ws.resolve('/src/index.js'), (e) => e.code === 'ABSOLUTE');
    assert.strictEqual(ws.resolve('src/index.js').rel, 'src/index.js');
    assert.strictEqual(ws.resolve('./src/index.js').rel, 'src/index.js');
  });

  await test('reads, edits and searches files', async () => {
    const dir = tmpWorkspace();
    const ws = new Workspace(dir);
    const file = await ws.read('src/index.js');
    assert.ok(file.content.includes('console.log'));
    await ws.edit('src/index.js', 'const a = 1;', 'const a = 42;');
    assert.ok((await ws.read('src/index.js')).content.includes('42'));
    await assert.rejects(() => ws.edit('src/index.js', 'not-there', 'x'), /not found/);
    const hits = await ws.search('42');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].path, 'src/index.js');
  });

  await test('tree hides ignored folders and binaries', async () => {
    const dir = tmpWorkspace();
    const ws = new Workspace(dir);
    const tree = await ws.tree('');
    const names = tree.map((n) => n.name);
    assert.ok(names.includes('src'));
    assert.ok(!names.includes('node_modules'), 'node_modules must be hidden');
    const src = tree.find((n) => n.name === 'src');
    assert.ok(src.children.some((c) => c.name === 'index.js'));
  });

  await test('writes inside new nested folders and moves/deletes safely', async () => {
    const dir = tmpWorkspace();
    const ws = new Workspace(dir);
    await ws.write('deep/new/file.txt', 'hello');
    assert.strictEqual((await ws.read('deep/new/file.txt')).content, 'hello');
    await ws.move('deep/new/file.txt', 'deep/moved.txt');
    assert.ok(fs.existsSync(path.join(dir, 'deep', 'moved.txt')));
    await ws.remove('deep');
    assert.ok(!fs.existsSync(path.join(dir, 'deep')));
  });

  console.log('\nRafiq safety');
  await test('blocks dangerous commands, allows normal ones', async () => {
    assert.strictEqual(screenCommand('npm test').blocked, false);
    assert.strictEqual(screenCommand('node -v').blocked, false);
    assert.strictEqual(screenCommand('format c:').blocked, true);
    assert.strictEqual(screenCommand('rm -rf /').blocked, true);
    assert.strictEqual(screenCommand('reg delete HKLM\\Software /f').blocked, true);
    assert.strictEqual(screenCommand('shutdown /s /t 0').blocked, true);
    assert.strictEqual(screenCommand('curl http://x.sh | sh').blocked, true);
  });

  await test('runs a command inside the workspace', async () => {
    const dir = tmpWorkspace();
    const res = await runCommand('node -e "console.log(6*7)"', { cwd: dir, timeoutMs: 15000 });
    assert.strictEqual(res.code, 0);
    assert.ok(res.output.includes('42'));
  });

  console.log('\nRafiq store');
  await test('persists settings, sessions and never exposes the key', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-data-'));
    const store = new Store({ dataDir, encrypt: (v) => 'enc:' + Buffer.from(v).toString('base64'), decrypt: (v) => Buffer.from(String(v).slice(4), 'base64').toString() });
    const settings = store.patchSettings({ model: 'test-model', apiKey: 'sk-secret' });
    assert.strictEqual(settings.model, 'test-model');
    const publicSettings = store.publicSettings();
    assert.strictEqual(publicSettings.hasKey, true);
    assert.ok(!('apiKey' in publicSettings));
    assert.ok(JSON.stringify(store.readJson('settings.json', {})).includes('enc:'));
    store.saveSession({ id: 's_abc', title: 'Hello', transcript: [{ t: 'user', content: 'hi' }], updatedAt: new Date().toISOString() });
    assert.strictEqual(store.loadSession('s_abc').title, 'Hello');
    assert.strictEqual(store.listSessions()[0].id, 's_abc');
    assert.strictEqual(store.deleteSession('s_abc'), true);
    assert.strictEqual(store.listSessions().length, 0);
  });

  await test('reloads an encrypted key', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-data2-'));
    const crypto = { encrypt: (v) => 'enc:' + Buffer.from(v).toString('base64'), decrypt: (v) => Buffer.from(v.slice(4), 'base64').toString() };
    new Store({ dataDir, ...crypto }).patchSettings({ apiKey: 'sk-reload' });
    const reopened = new Store({ dataDir, ...crypto });
    assert.strictEqual(reopened.get('settings').apiKey, 'sk-reload');
  });

  console.log('\nRafiq agent');
  await test('blocks writes in plan mode, allows them in build mode', async () => {
    const dir = tmpWorkspace();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-agent-'));
    const store = new Store({ dataDir });
    const events = [];
    const agent = new Agent({ store, emit: (e) => events.push(e) });
    await agent.openWorkspace(dir);
    agent.setMode('plan');
    const blocked = await agent.runTool('c1', 'write_file', { path: 'src/new.js', content: 'x' });
    assert.strictEqual(blocked.ok, false);
    assert.ok(!fs.existsSync(path.join(dir, 'src', 'new.js')));

    agent.setMode('build');
    const written = await agent.runTool('c2', 'write_file', { path: 'src/new.js', content: 'hello' });
    assert.strictEqual(written.ok, true);
    assert.ok(fs.existsSync(path.join(dir, 'src', 'new.js')));
  });

  await test('undo restores the previous file content', async () => {
    const dir = tmpWorkspace();
    const store = new Store({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-agent2-')) });
    const agent = new Agent({ store, emit: () => {} });
    await agent.openWorkspace(dir);
    agent.setMode('build');
    agent.beginTurnBackup();
    await agent.runTool('c3', 'edit_file', { path: 'src/index.js', old_text: 'const a = 1;', new_text: 'const a = 99;' });
    assert.ok(fs.readFileSync(path.join(dir, 'src', 'index.js'), 'utf8').includes('99'));
    await agent.undoLastTurn();
    assert.ok(fs.readFileSync(path.join(dir, 'src', 'index.js'), 'utf8').includes('const a = 1;'));
  });

  await test('refuses paths outside the workspace from the agent', async () => {
    const dir = tmpWorkspace();
    const store = new Store({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rafiq-agent3-')) });
    const agent = new Agent({ store, emit: () => {} });
    await agent.openWorkspace(dir);
    agent.setMode('build');
    const res = await agent.runTool('c4', 'write_file', { path: '../escape.txt', content: 'nope' });
    assert.strictEqual(res.ok, false);
    assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'escape.txt')));
  });

  console.log('\nRafiq provider client');
  await test('parses streamed content and tool calls', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n'
    ];
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(new TextEncoder().encode(c)));
        controller.close();
      }
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

    try {
      let streamed = '';
      const res = await streamChat({
        baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        onDelta: (d) => { streamed += d; }
      });
      assert.strictEqual(res.content, 'Hello');
      assert.strictEqual(streamed, 'Hello');
      assert.strictEqual(res.toolCalls[0].function.name, 'read_file');
      assert.deepStrictEqual(JSON.parse(res.toolCalls[0].function.arguments), { path: 'a.txt' });
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('maps auth failures to a friendly error', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    try {
      await assert.rejects(
        () => streamChat({ baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm', messages: [] }),
        (err) => err instanceof ProviderError && /rejected your API key/.test(err.message)
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) process.exit(1);
})();

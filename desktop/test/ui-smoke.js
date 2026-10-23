/*
 * Renderer smoke test — boots the real UI in jsdom with a stubbed API and
 * drives it: workspace, sessions, file tree, modes, settings, sending,
 * streamed assistant output, tool cards, plan cards, i18n and theming.
 *   node test/ui-smoke.js
 * Skips cleanly when jsdom is not installed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.log('\nRafiq renderer smoke test: skipped (jsdom is not installed — run npm install)\n');
  process.exit(0);
}

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8').replace('<script src="app.js"></script>', '');
const appJs = fs.readFileSync(path.join(RENDERER, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(RENDERER, 'styles.css'), 'utf8');

const failures = [];
const errors = [];
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://127.0.0.1:4123/' });
const { window } = dom;
window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
window.console.error = (...args) => errors.push('console.error: ' + args.join(' '));

const API_STATE = {
  platform: 'win32', version: '0.2.0', browser: true, home: 'C:\\Users\\you',
  state: {
    workspace: { root: 'C:\\Users\\you\\projects\\demo', name: 'demo' },
    mode: 'plan', busy: false, sessionId: 's1', sessionTitle: null, canUndo: false
  },
  settings: {
    provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini',
    temperature: 0.2, hasKey: true, theme: 'dark', lang: 'en', userName: 'Ahmed',
    requireCommandApproval: true, allowDangerousCommands: false
  },
  presets: [
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1-mini', 'gpt-4.1'] },
    { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5-coder:7b'] }
  ],
  sessions: [{ id: 's1', title: 'Earlier work', updatedAt: new Date().toISOString(), mode: 'build', count: 2 }],
  recents: ['C:\\Users\\you\\projects\\demo']
};

const TREE = [
  { type: 'dir', name: 'src', path: 'src', children: [{ type: 'file', name: 'index.js', path: 'src/index.js', size: 1234 }] },
  { type: 'file', name: 'README.md', path: 'README.md', size: 456 }
];

window.fetch = async (url) => {
  const href = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.startsWith('/api/state')) return json(API_STATE);
  if (href.startsWith('/api/tree')) return json({ ok: true, nodes: TREE });
  if (href.startsWith('/api/file')) return json({ ok: true, file: { path: 'src/index.js', size: 12, content: 'console.log(1);\n' } });
  if (href.startsWith('/api/settings')) return json({ ok: true, settings: API_STATE.settings });
  if (href.startsWith('/api/session/new')) return json({ ok: true, state: API_STATE.state });
  if (href.startsWith('/api/session/load')) return json({ ok: true, state: API_STATE.state, session: { transcript: [], plans: [] } });
  if (href.startsWith('/api/models')) return json({ ok: true, models: ['gpt-4.1', 'gpt-4.1-mini'] });
  return json({ ok: true });
};

let eventSource = null;
class FakeEventSource {
  constructor() { eventSource = this; setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'hello' }) }), 5); }
  close() {}
}
window.EventSource = FakeEventSource;
window.navigator.clipboard = { writeText: async () => {} };

function emit(event) {
  if (!eventSource || !eventSource.onmessage) throw new Error('renderer has not subscribed to events');
  eventSource.onmessage({ data: JSON.stringify(event) });
}

try {
  window.eval(appJs);
} catch (err) {
  errors.push('eval: ' + err.stack);
}

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures.push(name); console.log('  ✕ ' + name + ' — ' + err.message); }
}

(async () => {
  await wait(250);
  console.log('\nRafiq renderer (jsdom)');

  check('boots without console/runtime errors', () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });
  check('shows the workspace path and recent sessions', () => {
    if (!$('#ws-path').textContent.includes('projects')) throw new Error($('#ws-path').textContent);
    if (!$('#session-list').textContent.includes('Earlier work')) throw new Error('sessions missing');
  });
  check('renders the file tree and model chip', () => {
    if (!$('#file-tree').textContent.includes('index.js')) throw new Error('tree missing');
    if ($('#model-label').textContent !== 'gpt-4.1-mini') throw new Error($('#model-label').textContent);
  });
  check('mode switch updates aria-selected', () => {
    $('.mode[data-mode="build"]').click();
    if ($('.mode[data-mode="build"]').getAttribute('aria-selected') !== 'true') throw new Error('not selected');
  });

  $('#btn-settings').click();
  check('settings modal opens with providers and no key echo', () => {
    if ($('#modal-settings').hidden) throw new Error('modal still hidden');
    if ($('#set-provider').options.length < 2) throw new Error('providers missing');
    if ($('#set-apikey').value !== '') throw new Error('key leaked into the form');
  });
  window.document.querySelector('[data-close="modal-settings"]').click();

  $('#btn-explorer').click();
  await wait();
  const row = $$('.tree-row').find((r) => r.textContent.includes('index.js'));
  if (row) row.click();
  await wait();
  check('file viewer shows the file contents', () => {
    if ($('#file-view').hidden) throw new Error('viewer hidden');
    if (!$('#file-code').textContent.includes('console.log')) throw new Error('content missing');
  });

  const input = $('#input');
  input.value = 'Explain this project';
  input.dispatchEvent(new window.Event('input'));
  $('#btn-send').click();
  await wait(180);
  check('sending adds a user bubble and clears the composer', () => {
    if (input.value !== '') throw new Error('input not cleared');
    if (!$('#messages').textContent.includes('Explain this project')) throw new Error('no bubble');
    if (!$('#welcome').classList.contains('hidden')) throw new Error('welcome still visible');
  });

  /* streamed assistant output + a tool card + a plan card */
  emit({ type: 'assistant:start' });
  emit({ type: 'assistant:delta', text: 'Reading the project.\n\n- src/index.js\n' });
  await wait(150);
  emit({ type: 'tool:start', id: 't1', name: 'read_file', args: { path: 'src/index.js' } });
  emit({ type: 'tool:end', id: 't1', name: 'read_file', ok: true, summary: 'src/index.js · 12 lines', output: 'console.log(1);', ms: 42 });
  const planText = '## Plan\n\n1. Edit `src/index.js`\n2. Run the tests';
  emit({ type: 'assistant:end', content: planText });
  emit({ type: 'plan', content: planText });
  await wait(150);

  check('renders a plan with markdown instead of a duplicate bubble', () => {
    const cards = $$('.plan-card');
    if (cards.length !== 1) throw new Error('expected exactly one plan card, got ' + cards.length);
    if (!$$('.plan-card li').length) throw new Error('markdown list not rendered');
    if ($$('.msg.assistant').length) throw new Error('duplicate assistant bubble kept');
    const occurrences = $('#messages').textContent.split('Run the tests').length - 1;
    if (occurrences !== 1) throw new Error('plan rendered ' + occurrences + ' times');
  });
  check('renders tool cards with status', () => {
    const card = $('.tool-card');
    if (!card) throw new Error('no tool card');
    if (!card.classList.contains('ok')) throw new Error('status not applied: ' + card.className);
    if (!card.textContent.includes('src/index.js')) throw new Error('summary missing');
  });
  check('plan card offers approve and revise actions', () => {
    const plan = $('.plan-card');
    if (!plan.textContent.includes('Approve')) throw new Error('approve button missing');
    if (!plan.querySelector('.act-revise')) throw new Error('revise button missing');
  });
  check('errors surface in the transcript', () => {
    emit({ type: 'error', message: 'The provider rejected your API key.' });
    if (!$('.msg-error') || !$('#messages').textContent.includes('rejected your API key')) throw new Error('error not rendered');
  });
  check('approval requests open the modal', () => {
    emit({ type: 'approval', id: 'a1', kind: 'command', title: 'Run this command?', detail: 'npm test', dangerous: false });
    if ($('#modal-approval').hidden) throw new Error('approval modal not shown');
    if ($('#approval-detail').textContent !== 'npm test') throw new Error('command not shown');
  });

  $('#btn-lang').click();
  check('arabic switch translates and sets RTL', () => {
    if (window.document.documentElement.dir !== 'rtl') throw new Error(window.document.documentElement.dir);
    if (!/[\u0600-\u06FF]/.test($('#welcome h1').textContent)) throw new Error('title not translated');
    if (!$('#input').placeholder.match(/[\u0600-\u06FF]/)) throw new Error('placeholder not translated');
  });
  check('rtl keeps code blocks LTR', () => {
    if (!css.includes('html[dir="rtl"] .file-code')) throw new Error('missing rtl code rule');
  });

  $('#btn-theme').click();
  check('theme toggles to light', () => {
    if (window.document.documentElement.dataset.theme !== 'light') throw new Error(window.document.documentElement.dataset.theme);
  });
  check('no runtime errors during interaction', () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });

  console.log(`\n${failures.length ? 'FAILED: ' + failures.join(', ') : 'Renderer OK'}\n`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

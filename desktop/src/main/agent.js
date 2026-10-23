/* Rafiq — agent loop: plan → build → discuss, with tools & approvals. */
'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { Workspace, WorkspaceError } = require('./workspace');
const { runCommand, screenCommand, shellHint } = require('./commands');
const { streamChat, ProviderError } = require('./providers');
const { clamp, uid, nowISO, humanBytes } = require('./util');
const fsSync = require('fs');

const MAX_STEPS = 48;
const MAX_HISTORY = 60;
const TOOL_RESULT_LIMIT = 12000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders in a directory of the workspace (recursive, ignores node_modules and binaries).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative folder path. Use "." or omit for the workspace root.' },
          depth: { type: 'integer', description: 'How many levels deep to walk (1-5). Default 2.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file. Always read a file before editing it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          start_line: { type: 'integer', description: 'First line to return (1-based, optional).' },
          end_line: { type: 'integer', description: 'Last line to return (optional).' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a file or overwrite it completely. Prefer edit_file for small changes to existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          content: { type: 'string', description: 'The full file content.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact snippet of text in a file. old_text must match the file exactly, including indentation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string', description: 'Exact text to find.' },
          new_text: { type: 'string', description: 'Replacement text (empty string deletes the snippet).' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' }
        },
        required: ['path', 'old_text', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search the workspace for a substring or regular expression and return matching lines with paths.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regular expression.' },
          max_results: { type: 'integer', description: 'Maximum hits (default 60).' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a terminal command inside the workspace root and return its output. Use it to install, build and test. Never start long-lived servers without stopping them.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The exact command line.' },
          timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (default 60000, max 600000).' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Create a folder inside the workspace (parents included).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Delete a file or folder inside the workspace. Use carefully; this is recoverable only with Rafiq undo.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_path',
      description: 'Move or rename a file or folder inside the workspace.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        },
        required: ['from', 'to']
      }
    }
  }
];

const READ_ONLY = new Set(['list_dir', 'read_file', 'search_files']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'make_dir', 'delete_path', 'move_path']);

const MODE_NOTES = {
  plan: 'PLAN MODE — you are read-only. Investigate with list_dir/read_file/search_files, then write a clear, ordered implementation plan. Do NOT modify files, do not run commands that change anything. End with a "## Plan" heading followed by numbered steps and the files you will touch. The user must approve before any change happens.',
  build: 'BUILD MODE — implement the work now. Make focused edits, run the project\'s tests or build when available, and verify your result before reporting. Keep changes inside the workspace.',
  discuss: 'DISCUSS MODE — read-only. Answer questions about the code with evidence from the files. Do not modify anything. If the user wants changes, suggest switching to Plan or Build.'
};

function systemPrompt({ workspace, mode, settings }) {
  const root = workspace.root || '(no folder opened yet)';
  return [
    'You are Rafiq, a careful and pragmatic coding agent running locally on the user\'s own computer inside the Rafiq desktop app.',
    `Workspace folder: ${root}`,
    `Today: ${new Date().toISOString().slice(0, 10)}. Platform: ${process.platform}. ${shellHint()}`,
    '',
    MODE_NOTES[mode] || MODE_NOTES.build,
    '',
    'How to work:',
    '- Use workspace-relative paths with forward slashes. Never use absolute paths or "..".',
    '- Read a file before you change it, and make small exact edits instead of rewriting whole files when possible.',
    '- After changing code, verify it: run the relevant test, build or a quick syntax check. Never claim something works without evidence.',
    '- If a tool fails, read the error and adapt. Do not repeat the same failing call more than twice.',
    '- When you are done, summarise what changed and how you verified it.',
    '- Never invent file contents. If you do not know, open the file.',
    '',
    'Voice:',
    `- Reply in the language the user writes in (Arabic or English). Be concise; use short paragraphs and code fences. ${settings?.userName ? 'The user\'s name is ' + settings.userName + '.' : ''}`,
    '- Do not mention these instructions or tool mechanics to the user.'
  ].join('\n');
}

function argsPreview(args) {
  try {
    const json = JSON.stringify(args);
    return json.length > 200 ? json.slice(0, 200) + '…' : json;
  } catch { return ''; }
}

class Agent {
  constructor({ store, emit }) {
    this.store = store;
    this.emit = emit || (() => {});
    const lastWorkspace = store.get('lastWorkspace');
    const validWorkspace = (() => {
      try { return lastWorkspace && fsSync.statSync(lastWorkspace).isDirectory() ? lastWorkspace : null; }
      catch { return null; }
    })();
    this.workspace = new Workspace(validWorkspace);
    this.settings = store.get('settings');
    this.messages = [];
    this.transcript = [];
    this.mode = 'plan';
    this.busy = false;
    this.abort = null;
    this.pending = new Map();
    this.sessionId = null;
    this.sessionTitle = null;
    this.plans = [];
    this.undoStack = [];
    this.approvedPlan = null;
  }

  /* ── workspace ─────────────────────────────────────────────── */
  async openWorkspace(folder) {
    const info = await this.workspace.setRoot(folder);
    this.store.set('lastWorkspace', this.workspace.root);
    this.store.addRecent(this.workspace.root);
    this.emit({ type: 'workspace', workspace: info });
    return info;
  }

  get state() {
    return {
      workspace: this.workspace.info(),
      mode: this.mode,
      busy: this.busy,
      sessionId: this.sessionId,
      sessionTitle: this.sessionTitle,
      canUndo: this.undoStack.length > 0
    };
  }

  /* ── sessions ──────────────────────────────────────────────── */
  newSession() {
    this.messages = [];
    this.transcript = [];
    this.plans = [];
    this.sessionId = uid('s');
    this.createdAt = nowISO();
    this.sessionTitle = 'New session';
    this.emit({ type: 'session', state: this.state });
    return this.state;
  }

  loadSession(session) {
    this.messages = session.messages || [];
    this.transcript = session.transcript || [];
    this.mode = session.mode || 'plan';
    this.sessionId = session.id;
    this.sessionTitle = session.title || 'Session';
    this.plans = session.plans || [];
    this.emit({ type: 'session', state: this.state });
    return this.state;
  }

  sessionData() {
    return {
      id: this.sessionId,
      title: this.sessionTitle,
      workspace: this.workspace.root,
      mode: this.mode,
      messages: this.messages,
      transcript: this.transcript,
      plans: this.plans,
      createdAt: this.createdAt || nowISO(),
      updatedAt: nowISO()
    };
  }

  persist() {
    if (!this.sessionId) this.newSession();
    const data = this.sessionData();
    if (!this.sessionTitle || this.sessionTitle === 'New session') {
      const firstUser = this.transcript.find((t) => t.t === 'user');
      if (firstUser) {
        const words = firstUser.content.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
        this.sessionTitle = words.length > 3 ? words : this.sessionTitle;
        data.title = this.sessionTitle;
      }
    }
    this.store.saveSession(data);
    this.emit({ type: 'session', state: this.state });
  }

  setMode(mode) {
    if (!['plan', 'build', 'discuss'].includes(mode)) return this.mode;
    this.mode = mode;
    this.emit({ type: 'mode', mode });
    this.emit({ type: 'session', state: this.state });
    this.persist();
    return mode;
  }

  setSettings(patch) {
    this.settings = this.store.patchSettings(patch);
    const safe = this.store.publicSettings();
    this.emit({ type: 'settings', settings: safe });
    return safe;
  }

  /* ── approvals ─────────────────────────────────────────────── */
  requestApproval(payload) {
    const id = uid('ap');
    this.emit({ type: 'approval', id, ...payload });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.emit({ type: 'approval:expired', id });
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      this.pending.set(id, (allow) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(Boolean(allow));
      });
    });
  }

  resolveApproval(id, allow) {
    const fn = this.pending.get(id);
    if (fn) fn(allow);
    return Boolean(fn);
  }

  cancel() {
    if (this.abort) this.abort.abort();
    for (const [, fn] of this.pending) fn(false);
    this.pending.clear();
    this.busy = false;
  }

  /* ── backups / undo ────────────────────────────────────────── */
  beginTurnBackup() {
    const turn = { id: uid('turn'), files: new Map() };
    this.undoStack.push(turn);
    if (this.undoStack.length > 20) this.undoStack.shift();
    return turn;
  }

  async recordBackup(relPath) {
    const turn = this.undoStack[this.undoStack.length - 1];
    if (!turn || turn.files.has(relPath)) return;
    try {
      const { abs } = this.workspace.resolve(relPath);
      const content = await fsp.readFile(abs, 'utf8');
      turn.files.set(relPath, content);
    } catch {
      turn.files.set(relPath, null);
    }
  }

  async undoLastTurn() {
    const turn = this.undoStack.pop();
    if (!turn || !turn.files.size) throw new Error('Nothing to undo yet.');
    let restored = 0;
    for (const [rel, content] of turn.files) {
      try {
        const { abs } = this.workspace.resolve(rel);
        if (content === null) { await fsp.rm(abs, { force: true }); }
        else { await fsp.writeFile(abs, content, 'utf8'); restored++; }
      } catch { /* skip files outside / already gone */ }
    }
    this.emit({ type: 'notice', level: 'ok', text: `Undid ${turn.files.size} file change(s).` });
    this.emit({ type: 'workspace:changed' });
    return { restored, files: turn.files.size };
  }

  /* ── main loop ─────────────────────────────────────────────── */
  async send({ text, mode, attachments = [] }) {
    if (this.busy) throw new Error('Rafiq is already working — wait or press Stop.');
    if (!this.workspace.active) throw new Error('Open a folder first so Rafiq knows where to work.');
    if (!this.settings.apiKey && !/127\.0\.0\.1|localhost/.test(this.settings.baseUrl || '')) {
      throw new Error('Add your API key in Settings first (BYOK — it stays on this device).');
    }
    const prompt = (text || '').trim();
    if (!prompt) return;

    if (!this.sessionId) this.newSession();
    if (mode && mode !== this.mode) this.setMode(mode);

    // A plan the user approved becomes the working brief for build mode.
    this.busy = true;
    this.abort = new AbortController();
    const turnBackup = this.beginTurnBackup();
    this.emit({ type: 'turn:start', id: turnBackup.id, mode: this.mode });
    this.emit({ type: 'busy', busy: true });

    let userContent = prompt;
    if (attachments.length) {
      const blocks = attachments.slice(0, 4).map((a) => `\n\n<file path="${a.path}">\n${clamp(a.content, 20000)}\n</file>`).join('');
      userContent += blocks;
    }

    this.transcript.push({ t: 'user', content: prompt, attachments: attachments.map((a) => a.path), at: nowISO() });
    this.messages.push({ role: 'user', content: userContent });
    if (this.mode === 'build' && this.approvedPlan) {
      this.messages.push({ role: 'system', content: `The user approved this plan — follow it unless they ask otherwise:\n${this.approvedPlan}` });
      this.approvedPlan = null;
    }
    this.persist();
    this.emit({ type: 'transcript', entries: this.transcript.slice(-2) });

    let finalText = '';
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (!this.busy) break;
        const thinks = [];
        let content = '';
        let streamed = '';
        this.emit({ type: 'assistant:start' });

        const result = await streamChat({
          baseUrl: this.settings.baseUrl,
          apiKey: this.settings.apiKey,
          model: this.settings.model,
          messages: this.buildMessages(),
          tools: this.mode === 'discuss' ? TOOLS.filter((t) => READ_ONLY.has(t.function.name)) : TOOLS,
          temperature: this.settings.temperature,
          signal: this.abort.signal,
          onDelta: (delta) => {
            streamed += delta;
            this.emit({ type: 'assistant:delta', text: delta });
          }
        });

        content = result.content || streamed;
        if (result.usage) this.emit({ type: 'usage', usage: result.usage });

        if (result.toolCalls && result.toolCalls.length) {
          this.messages.push({ role: 'assistant', content: content || null, tool_calls: result.toolCalls });
          if (content.trim()) this.transcript.push({ t: 'assistant', content: content, at: nowISO() });
          this.emit({ type: 'assistant:end', content });

          for (const call of result.toolCalls) {
            const name = call.function.name;
            let args = {};
            try { args = JSON.parse(call.function.arguments || '{}'); }
            catch { args = {}; }

            const outcome = await this.runTool(call.id, name, args, turnBackup);
            this.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: clamp(outcome.content || '', TOOL_RESULT_LIMIT)
            });
            this.transcript.push({
              t: 'tool', name, args, ok: outcome.ok,
              summary: outcome.summary, output: outcome.display ? clamp(outcome.display, 4000) : undefined,
              at: nowISO()
            });
            this.persist();
          }
          this.emit({ type: 'transcript', entries: this.transcript.slice(-8) });
          finalText = content;
          continue;
        }

        finalText = content;
        this.messages.push({ role: 'assistant', content });
        this.transcript.push({ t: 'assistant', content, at: nowISO() });
        this.emit({ type: 'assistant:end', content });
        this.emit({ type: 'transcript', entries: this.transcript.slice(-2) });

        if (this.mode === 'plan' && content.trim()) {
          this.plans.push({ content, at: nowISO() });
          this.emit({ type: 'plan', content });
        }
        break;
      }
    } catch (err) {
      const message = err.name === 'AbortError'
        ? 'Stopped at your request.'
        : (err instanceof ProviderError ? err.message + (err.hint ? `\n\n${err.hint}` : '') : (err.message || String(err)));
      this.transcript.push({ t: 'error', content: message, at: nowISO() });
      this.emit({ type: 'error', message });
    } finally {
      this.busy = false;
      this.abort = null;
      this.emit({ type: 'busy', busy: false });
      this.emit({ type: 'turn:end', text: finalText });
      this.persist();
    }
    return finalText;
  }

  approvePlan(planContent) {
    this.approvedPlan = planContent;
    this.setMode('build');
    this.emit({ type: 'notice', level: 'ok', text: 'Plan approved — Rafiq will build it now.' });
  }

  buildMessages() {
    let history = this.messages.slice();
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
      // never start with an orphan tool result
      while (history.length && history[0].role === 'tool') history.shift();
    }
    return [{ role: 'system', content: systemPrompt({ workspace: this.workspace, mode: this.mode, settings: this.settings }) }, ...history];
  }

  /* ── tool execution ────────────────────────────────────────── */
  async runTool(callId, name, args, turnBackup) {
    const started = Date.now();
    this.emit({ type: 'tool:start', id: callId, name, args });

    const finish = (outcome) => {
      this.emit({
        type: 'tool:end', id: callId, name, ok: outcome.ok,
        summary: outcome.summary, output: outcome.display ? clamp(outcome.display, 6000) : undefined,
        ms: Date.now() - started
      });
      return outcome;
    };

    try {
      if (!READ_ONLY.has(name) && this.mode !== 'build') {
        return finish({
          ok: false,
          summary: 'Blocked: read-only mode',
          content: `Tool "${name}" is not available in ${this.mode} mode. Present a plan and ask the user to switch to Build mode instead.`
        });
      }

      if (WRITE_TOOLS.has(name)) {
        const target = args.path || args.from;
        if (target && this.workspace) {
          try { this.workspace.resolve(target); } catch (err) { return finish({ ok: false, summary: err.message, content: err.message }); }
        }
      }

      switch (name) {
        case 'list_dir': {
          const depth = Math.min(Math.max(Number(args.depth) || 2, 1), 5);
          const rel = !args.path || args.path === '.' ? '' : args.path;
          const nodes = await this.workspace.tree(rel, depth);
          const render = (list, indent = '') => list.map((n) => n.type === 'dir'
            ? `${indent}${n.name}/` + (n.children.length ? '\n' + render(n.children, indent + '  ') : '')
            : `${indent}${n.name} (${humanBytes(n.size)})`
          ).join('\n');
          const body = render(nodes) || '(empty folder)';
          return finish({
            ok: true,
            summary: `${nodes.length} item(s) in ${rel || '/'}`,
            content: `Contents of ${rel || 'workspace root'}:\n${body}`,
            display: body
          });
        }

        case 'read_file': {
          const file = await this.workspace.read(args.path);
          let body = file.content;
          if (args.start_line || args.end_line) {
            const lines = body.split(/\r?\n/);
            const from = Math.max((Number(args.start_line) || 1) - 1, 0);
            const to = Math.min(Number(args.end_line) || lines.length, lines.length);
            body = lines.slice(from, to).map((l, i) => `${from + i + 1}\t${l}`).join('\n');
          }
          const lines = file.content.split(/\r?\n/).length;
          return finish({
            ok: true,
            summary: `${file.path} · ${lines} lines`,
            content: `File: ${file.path} (${humanBytes(file.size)}, ${lines} lines)\n\n${clamp(body, 30000)}`
          });
        }

        case 'write_file': {
          await this.recordBackup(args.path);
          const res = await this.workspace.write(args.path, args.content ?? '');
          this.emit({ type: 'workspace:changed' });
          return finish({
            ok: true,
            summary: `Wrote ${res.path} (${humanBytes(res.bytes)})`,
            content: `Wrote ${res.bytes} bytes to ${res.path}.`,
            display: `+ ${res.path} (${humanBytes(res.bytes)})`
          });
        }

        case 'edit_file': {
          await this.recordBackup(args.path);
          const res = await this.workspace.edit(args.path, args.old_text ?? '', args.new_text ?? '', { all: Boolean(args.replace_all) });
          this.emit({ type: 'workspace:changed' });
          return finish({
            ok: true,
            summary: `Edited ${res.path} (${res.replacements} replacement${res.replacements === 1 ? '' : 's'})`,
            content: `Edited ${res.path} — ${res.replacements} replacement(s).`,
            display: `~ ${res.path}`
          });
        }

        case 'search_files': {
          const hits = await this.workspace.search(args.query, { maxHits: Math.min(Number(args.max_results) || 60, 200) });
          const body = hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n') || 'No matches.';
          return finish({
            ok: true,
            summary: `${hits.length} match(es) for "${clamp(args.query, 40)}"`,
            content: `Search results for ${JSON.stringify(args.query)}:\n${body}`,
            display: body
          });
        }

        case 'make_dir': {
          const res = await this.workspace.mkdir(args.path);
          this.emit({ type: 'workspace:changed' });
          return finish({ ok: true, summary: `Created ${res.path}/`, content: `Created folder ${res.path}.` });
        }

        case 'delete_path': {
          await this.recordBackup(args.path);
          const res = await this.workspace.remove(args.path);
          this.emit({ type: 'workspace:changed' });
          return finish({ ok: true, summary: `Deleted ${res.path}`, content: `Deleted ${res.path}${res.directory ? ' (folder)' : ''}.` });
        }

        case 'move_path': {
          await this.recordBackup(args.from);
          const res = await this.workspace.move(args.from, args.to);
          this.emit({ type: 'workspace:changed' });
          return finish({ ok: true, summary: `Moved ${res.from} → ${res.to}`, content: `Moved ${res.from} to ${res.to}.` });
        }

        case 'run_command': {
          const command = String(args.command || '').trim();
          if (!command) return finish({ ok: false, summary: 'Empty command', content: 'No command was provided.' });

          const screen = screenCommand(command);
          if (screen.blocked && !this.settings.allowDangerousCommands) {
            return finish({
              ok: false,
              summary: 'Blocked: ' + screen.reason,
              content: `Refused to run this command: it involves ${screen.reason}, which is locked by Rafiq safety settings. Use a narrower command, or tell the user to enable dangerous commands in Settings if they really mean it.`
            });
          }

          if (this.settings.requireCommandApproval) {
            const allowed = await this.requestApproval({
              kind: 'command',
              title: 'Run this command?',
              detail: command,
              dangerous: screen.blocked,
              reason: screen.blocked ? `This involves ${screen.reason}.` : 'Commands run inside your workspace folder.'
            });
            if (!allowed) {
              return finish({ ok: false, summary: 'Command denied by user', content: 'The user did not approve this command. Ask how they would like to proceed instead of retrying.' });
            }
          }

          this.emit({ type: 'command:start', command });
          const result = await runCommand(command, {
            cwd: this.workspace.root,
            timeoutMs: Math.min(Number(args.timeout_ms) || 60000, 600000),
            signal: this.abort?.signal,
            onData: (chunk) => this.emit({ type: 'command:output', command, chunk: clamp(chunk, 2000) })
          });
          this.emit({ type: 'command:end', command, code: result.code });
          this.emit({ type: 'workspace:changed' });

          const display = `$ ${command}\n${result.output || '(no output)'}`;
          return finish({
            ok: result.code === 0,
            summary: `${command.split(/\s+/)[0]} exited ${result.code} in ${(result.durationMs / 1000).toFixed(1)}s`,
            content: `Command: ${command}\nExit code: ${result.code}\nOutput:\n${clamp(result.output || '(no output)', 12000)}${result.truncated ? '\n[output truncated]' : ''}`,
            display
          });
        }

        default:
          return finish({ ok: false, summary: 'Unknown tool: ' + name, content: `Unknown tool "${name}". Available tools: ${TOOLS.map((t) => t.function.name).join(', ')}.` });
      }
    } catch (err) {
      const message = err instanceof WorkspaceError ? err.message : (err.message || String(err));
      return finish({ ok: false, summary: message, content: 'Error: ' + message });
    }
  }
}

module.exports = { Agent, TOOLS };

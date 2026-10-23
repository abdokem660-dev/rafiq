/* Rafiq — shell command runner with a conservative denylist. */
'use strict';

const { spawn } = require('child_process');
const os = require('os');

const DENY = [
  { re: /\b(format|diskpart|bcdedit|bootrec)\b/i, why: 'disk or boot configuration changes' },
  { re: /\breg(\.exe)?\s+delete\b/i, why: 'registry deletion' },
  { re: /\b(shutdown|restart-computer|stop-computer)\b/i, why: 'powering off the machine' },
  { re: /\b(net\s+user|net\s+localgroup)\b/i, why: 'modifying user accounts' },
  { re: /\b(rm|del|erase)\b[^\n]*(\s-r\s*-f|\/s|\/f)[^\n]*(\/|\\)\s*$/i, why: 'mass deletion' },
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|\*|~|\$HOME)/i, why: 'mass deletion' },
  { re: /\b(mkfs|dd\s+if=)/i, why: 'raw disk writes' },
  { re: /\b(sudo|runas|takeown|icacls)\b/i, why: 'privilege / ownership changes' },
  { re: /\b(powershell|pwsh)\b[^\n]*\s-(e|en|enc|encodedcommand)\b/i, why: 'encoded PowerShell' },
  { re: /\b(iwr|invoke-webrequest|curl|wget)\b[^\n]*\|\s*(sh|bash|iex|invoke-expression|powershell)/i, why: 'piping downloads into a shell' },
  { re: /\b(tasks?kill|killall)\b[^\n]*\/f[^\n]*\/(im|pid)/i, why: 'killing processes' },
  { re: /\bwevtutil\b|\bcipher\s+\/w\b/i, why: 'clearing security logs' },
  { re: /\b(git\s+push\s+--force|git\s+reset\s+--hard\s+origin|git\s+clean\s+-[a-z]*f)/i, why: 'destructive git operations' },
  { re: /\bnpm\s+publish\b|\bpip\s+install\b[^\n]*--break-system-packages/i, why: 'publishing packages' },
  { re: /:\(\)\s*\{.*\|.*&.*\}\s*;?\s*:/, why: 'fork bomb' },
  { re: /\bchmod\s+(-r\s+)?777\s+\/(\s|$)/i, why: 'loosening permissions on /' }
];

const MAX_OUTPUT = 16000;

function screenCommand(command) {
  for (const rule of DENY) {
    if (rule.re.test(command)) return { blocked: true, reason: rule.why };
  }
  return { blocked: false };
}

/**
 * Run a command inside the workspace root.
 * Resolves with { code, output, truncated, durationMs }.
 */
function runCommand(command, { cwd, timeoutMs = 60000, signal, onData } = {}) {
  return new Promise((resolve) => {
    if (!command || typeof command !== 'string') {
      resolve({ code: -1, output: 'No command provided.', durationMs: 0 });
      return;
    }
    const isWin = process.platform === 'win32';
    const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
    const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
    const started = Date.now();
    let output = '';
    let truncated = false;

    let child;
    try {
      child = spawn(shell, args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, RAFIQ: '1', CI: process.env.CI || '1', GIT_PAGER: 'cat', PAGER: 'cat' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ code: -1, output: 'Could not start the shell: ' + err.message, durationMs: 0 });
      return;
    }

    const push = (chunk) => {
      const text = chunk.toString();
      if (output.length < MAX_OUTPUT) {
        output += text;
        if (onData) onData(text);
      } else {
        truncated = true;
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      output += `\n[rafiq] Command timed out after ${Math.round(timeoutMs / 1000)}s.`;
    }, Math.min(Math.max(timeoutMs, 1000), 600000));

    const onAbort = () => { try { child.kill('SIGKILL'); } catch {} };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: output + '\n' + err.message, durationMs: Date.now() - started });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (output.length > MAX_OUTPUT) { truncated = true; output = output.slice(0, MAX_OUTPUT); }
      resolve({ code: code == null ? -1 : code, output: output.trim(), truncated, durationMs: Date.now() - started });
    });
  });
}

function shellHint() {
  return process.platform === 'win32'
    ? `Windows ${os.release()} — commands run in cmd.exe, use Windows syntax (dir, type, node, npm).`
    : `${process.platform} ${os.release()} — commands run in /bin/sh.`;
}

module.exports = { runCommand, screenCommand, shellHint, MAX_OUTPUT };

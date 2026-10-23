/* Rafiq — workspace sandbox: every filesystem access goes through here. */
'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { DEFAULT_IGNORE, IGNORE_GLOBS, isProbablyText, isIgnoredName, clamp, toPosix } = require('./util');

const MAX_READ = 200 * 1024;          // 200 KB per file
const MAX_TREE_NODES = 4000;          // cap the tree walk
const MAX_SEARCH_HITS = 200;

class WorkspaceError extends Error {
  constructor(message, code = 'WORKSPACE') { super(message); this.code = code; }
}

class Workspace {
  constructor(root) {
    this.root = root ? path.resolve(root) : null;
    this.ignore = new Set(DEFAULT_IGNORE);
  }

  get active() { return Boolean(this.root); }

  async setRoot(root) {
    const resolved = path.resolve(root);
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new WorkspaceError('That folder does not exist.', 'ENOENT');
    this.root = resolved;
    await this.loadIgnoreFile();
    return this.info();
  }

  async loadIgnoreFile() {
    this.ignore = new Set(DEFAULT_IGNORE);
    if (!this.root) return;
    for (const name of ['.rafiq-ignore', '.gitignore']) {
      try {
        const body = await fsp.readFile(path.join(this.root, name), 'utf8');
        body.split(/\r?\n/).forEach((line) => {
          const clean = line.trim().replace(/^\/+|\/+$/g, '');
          if (!clean || clean.startsWith('#')) return;
          if (/[*?[\]]/.test(clean)) return; // keep it simple: name-based ignores only
          this.ignore.add(clean);
        });
      } catch { /* optional */ }
    }
  }

  info() {
    return {
      root: this.root,
      name: this.root ? path.basename(this.root) : null
    };
  }

  /** Resolve a user/agent supplied relative path and guarantee it stays inside root. */
  resolve(relPath, { allowRoot = false } = {}) {
    if (!this.root) throw new WorkspaceError('No workspace is open yet.', 'NO_WORKSPACE');
    if (typeof relPath !== 'string') throw new WorkspaceError('A path is required.', 'BAD_PATH');
    if (/[\0]/.test(relPath)) throw new WorkspaceError('Invalid path.', 'BAD_PATH');
    if (/^([a-zA-Z]:[\\/]|\\\\|[\\/])/.test(relPath.trim())) {
      throw new WorkspaceError('Use a path relative to the workspace root (for example "src/app.js"), not an absolute one.', 'ABSOLUTE');
    }
    const cleaned = relPath.trim().replace(/^\.\//, '').replace(/^[\\/]+/, '');
    const abs = path.resolve(this.root, cleaned);
    const relative = path.relative(this.root, abs);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new WorkspaceError('That path is outside the workspace. Rafiq only works inside the folder you opened.', 'OUTSIDE');
    }
    if (!relative && !allowRoot) throw new WorkspaceError('That path is the workspace root itself.', 'BAD_PATH');
    return { abs, rel: toPosix(relative) };
  }

  isIgnored(relPath) {
    const parts = toPosix(relPath).split('/');
    return parts.some((p) => this.ignore.has(p)) || IGNORE_GLOBS.some((re) => re.test(relPath));
  }

  async tree(relDir = '', depthLimit = 6) {
    if (!this.root) return [];
    const base = this.resolve(relDir, { allowRoot: true });
    let budget = MAX_TREE_NODES;

    const walk = async (absDir, relPrefix, depth) => {
      if (depth > depthLimit || budget <= 0) return [];
      let entries;
      try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { return []; }
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const nodes = [];
      for (const entry of entries) {
        if (budget <= 0) break;
        if (isIgnoredName(entry.name) || entry.name.startsWith('.rafiq')) continue;
        const rel = relPrefix ? relPrefix + '/' + entry.name : entry.name;
        if (this.isIgnored(rel)) continue;
        budget--;
        if (entry.isDirectory()) {
          nodes.push({ type: 'dir', name: entry.name, path: rel, children: await walk(path.join(absDir, entry.name), rel, depth + 1) });
        } else if (entry.isFile()) {
          let size = 0;
          try { size = (await fsp.stat(path.join(absDir, entry.name))).size; } catch {}
          nodes.push({ type: 'file', name: entry.name, path: rel, size, text: isProbablyText(entry.name) });
        }
      }
      return nodes;
    };

    return walk(base.abs, base.rel, 0);
  }

  async read(relPath) {
    const { abs, rel } = this.resolve(relPath);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) throw new WorkspaceError(`File not found: ${rel}`, 'ENOENT');
    if (stat.isDirectory()) throw new WorkspaceError(`${rel} is a folder, not a file.`, 'EISDIR');
    if (stat.size > MAX_READ) throw new WorkspaceError(`${rel} is ${(stat.size / 1024 / 1024).toFixed(1)} MB — too large to open.`, 'TOO_LARGE');
    const content = await fsp.readFile(abs, 'utf8');
    return { path: rel, size: stat.size, content };
  }

  async write(relPath, content) {
    const { abs, rel } = this.resolve(relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content ?? '', 'utf8');
    return { path: rel, bytes: Buffer.byteLength(content ?? '', 'utf8') };
  }

  async append(relPath, content) {
    const { abs, rel } = this.resolve(relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.appendFile(abs, content ?? '', 'utf8');
    return { path: rel };
  }

  async edit(relPath, oldText, newText, { all = false } = {}) {
    const { abs, rel } = this.resolve(relPath);
    const before = await fsp.readFile(abs, 'utf8');
    if (!before.includes(oldText)) {
      throw new WorkspaceError(`The text to replace was not found in ${rel}. Read the file again and copy the exact text.`, 'NO_MATCH');
    }
    const after = all ? before.split(oldText).join(newText) : before.replace(oldText, newText);
    await fsp.writeFile(abs, after, 'utf8');
    return { path: rel, replacements: all ? before.split(oldText).length - 1 : 1 };
  }

  async mkdir(relPath) {
    const { abs, rel } = this.resolve(relPath);
    await fsp.mkdir(abs, { recursive: true });
    return { path: rel };
  }

  async remove(relPath) {
    const { abs, rel } = this.resolve(relPath);
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) throw new WorkspaceError(`Nothing to delete at ${rel}.`, 'ENOENT');
    await fsp.rm(abs, { recursive: true, force: true });
    return { path: rel, directory: stat.isDirectory() };
  }

  async move(fromRel, toRel) {
    const from = this.resolve(fromRel);
    const to = this.resolve(toRel);
    await fsp.mkdir(path.dirname(to.abs), { recursive: true });
    await fsp.rename(from.abs, to.abs);
    return { from: from.rel, to: to.rel };
  }

  async search(query, { maxHits = MAX_SEARCH_HITS, maxFiles = 4000 } = {}) {
    if (!this.root) return [];
    if (!query || query.length < 2) throw new WorkspaceError('Search needs at least 2 characters.', 'BAD_QUERY');
    let regex;
    try { regex = new RegExp(query, 'i'); } catch { regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    const hits = [];
    let files = 0;

    const walk = async (absDir, relPrefix, depth) => {
      if (hits.length >= maxHits || files > maxFiles || depth > 10) return;
      let entries;
      try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (hits.length >= maxHits || files > maxFiles) return;
        const rel = relPrefix ? relPrefix + '/' + entry.name : entry.name;
        if (isIgnoredName(entry.name) || this.isIgnored(rel)) continue;
        const abs = path.join(absDir, entry.name);
        if (entry.isDirectory()) { await walk(abs, rel, depth + 1); continue; }
        if (!entry.isFile() || !isProbablyText(entry.name)) continue;
        files++;
        let body;
        try {
          const stat = await fsp.stat(abs);
          if (stat.size > 512 * 1024) continue;
          body = await fsp.readFile(abs, 'utf8');
        } catch { continue; }
        body.split(/\r?\n/).forEach((line, idx) => {
          if (hits.length >= maxHits) return;
          if (regex.test(line)) hits.push({ path: rel, line: idx + 1, text: clamp(line.trim(), 240) });
        });
      }
    };

    await walk(this.root, '', 0);
    return hits;
  }
}

module.exports = { Workspace, WorkspaceError };

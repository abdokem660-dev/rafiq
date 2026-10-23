/* Rafiq — shared helpers (no dependencies) */
'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '__pycache__',
  '.venv', 'venv', 'target', '.next', '.nuxt', '.cache', '.idea', '.vscode',
  'vendor', 'Pods', '.gradle', 'bin', 'obj', '.rafiq', 'Thumbs.db', 'desktop.ini'
];

const IGNORE_GLOBS = [
  /\.lock$/i, /package-lock\.json$/i, /pnpm-lock\.yaml$/i, /yarn\.lock$/i,
  /\.(png|jpe?g|gif|webp|ico|bmp|tiff|mp4|mov|avi|mkv|mp3|wav|ogg|flac|zip|7z|rar|gz|tar|exe|dll|so|dylib|node|pyc|class|jar|woff2?|ttf|otf|eot|pdf|psd|ai|sketch|fig)$/i
];

const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|json|jsonc|css|scss|sass|less|html|htm|md|markdown|txt|yml|yaml|toml|ini|cfg|conf|sh|bat|cmd|ps1|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cs|php|swift|dart|lua|pl|r|sql|graphql|gql|xml|svg|vue|svelte|astro|env|gitignore|dockerfile)$/i;

function isProbablyText(file) {
  return TEXT_EXT.test(file) || !path.extname(file);
}

function isIgnoredName(name) {
  return DEFAULT_IGNORE.includes(name);
}

function clamp(str, max) {
  if (typeof str !== 'string') return str;
  return str.length > max ? str.slice(0, max) + `\n… [truncated ${str.length - max} chars]` : str;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function humanBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowISO() {
  return new Date().toISOString();
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

module.exports = {
  DEFAULT_IGNORE, IGNORE_GLOBS, TEXT_EXT,
  isProbablyText, isIgnoredName, clamp, toPosix, humanBytes, uid, nowISO, exists
};

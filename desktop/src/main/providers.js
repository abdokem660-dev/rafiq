/* Rafiq — OpenAI-compatible provider client (streaming, zero dependencies). */
'use strict';

const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'o4-mini'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'], keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'qwen/qwen3-coder'], keyUrl: 'https://openrouter.ai/keys' },
  { id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', models: ['meta/llama-3.3-70b-instruct', 'qwen/qwen2.5-coder-32b-instruct'], keyUrl: 'https://build.nvidia.com' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen2.5-coder:7b', 'llama3.2', 'deepseek-coder-v2'], keyUrl: null },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', models: ['local-model'], keyUrl: null },
  { id: 'custom', label: 'Custom endpoint', baseUrl: '', models: [], keyUrl: null }
];

class ProviderError extends Error {
  constructor(message, { status = 0, hint = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.hint = hint;
  }
}

function normalizeBase(url) {
  let base = (url || '').trim().replace(/\/+$/, '');
  if (!base) throw new ProviderError('No API base URL configured.', { hint: 'Open Settings and pick a provider, or paste a base URL such as https://api.openai.com/v1.' });
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  if (/\/chat\/completions$/i.test(base)) return base;
  return base;
}

function friendlyError(status, body) {
  const detail = (() => {
    try {
      const parsed = JSON.parse(body);
      return parsed?.error?.message || parsed?.message || body.slice(0, 400);
    } catch { return body.slice(0, 400); }
  })();
  if (status === 401 || status === 403) {
    return new ProviderError('The provider rejected your API key.', { status, hint: 'Check the key in Settings — it may be wrong, expired, or not allowed to use this model.' });
  }
  if (status === 404) {
    return new ProviderError('Model or endpoint not found (404).', { status, hint: 'Verify the model name and base URL in Settings. Base URLs usually end in /v1.' });
  }
  if (status === 429) {
    return new ProviderError('Rate limit or quota reached (429).', { status, hint: 'Wait a moment, check your provider balance, or switch to another model.' });
  }
  if (status >= 500) {
    return new ProviderError(`The provider had a server error (${status}).`, { status, hint: 'Usually temporary — try again in a few seconds.' });
  }
  return new ProviderError(`Provider error ${status}: ${detail}`, { status, hint: detail });
}

function parseSSEText(raw) {
  const events = [];
  for (const block of raw.split('\n\n')) {
    const dataLines = block.split('\n').filter((l) => l.startsWith('data:'));
    if (!dataLines.length) continue;
    const payload = dataLines.map((l) => l.slice(5).trim()).join('\n');
    if (!payload || payload === '[DONE]') continue;
    try { events.push(JSON.parse(payload)); } catch { /* ignore keep-alives */ }
  }
  return events;
}

function mergeToolDelta(acc, deltas) {
  for (const delta of deltas) {
    const idx = typeof delta.index === 'number' ? delta.index : acc.length;
    if (!acc[idx]) acc[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
    const slot = acc[idx];
    if (delta.id) slot.id = delta.id;
    if (delta.type) slot.type = delta.type;
    if (delta.function?.name) slot.function.name += delta.function.name;
    if (delta.function?.arguments) slot.function.arguments += delta.function.arguments;
  }
}

/**
 * Stream a chat completion.
 * @param {object} opts
 * @param {(delta: string) => void} [opts.onDelta]
 * @returns {Promise<{content: string, toolCalls: Array, finishReason: string, usage: object|null}>}
 */
async function streamChat({
  baseUrl, apiKey, model, messages, tools, temperature = 0.2,
  signal, onDelta, extraHeaders = {}, maxTokens = 4096
}) {
  if (!model) throw new ProviderError('No model selected.', { hint: 'Pick a model in Settings.' });
  const base = normalizeBase(baseUrl);
  const url = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...extraHeaders
  };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  if (/openrouter\.ai/i.test(base)) {
    headers['HTTP-Referer'] = 'https://github.com/abdokem660-dev/rafiq';
    headers['X-Title'] = 'Rafiq';
  }

  const body = { model, messages, stream: true, temperature };
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ProviderError('Could not reach the provider.', {
      hint: `Check your internet connection and the base URL (${base}). Local servers such as Ollama must be running.`
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw friendlyError(res.status, text);
  }

  if (!res.body) {
    const json = await res.json();
    const msg = json.choices?.[0]?.message || {};
    return { content: msg.content || '', toolCalls: msg.tool_calls || [], finishReason: json.choices?.[0]?.finish_reason || 'stop', usage: json.usage || null };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolAcc = [];
  let finishReason = 'stop';
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const boundary = buffer.lastIndexOf('\n\n');
    if (boundary === -1) continue;
    const chunk = buffer.slice(0, boundary + 2);
    buffer = buffer.slice(boundary + 2);
    for (const event of parseSSEText(chunk)) {
      if (event.error) throw new ProviderError(event.error.message || 'Provider stream error.');
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || choice.message || {};
      if (delta.content) {
        content += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      if (delta.tool_calls) mergeToolDelta(toolAcc, delta.tool_calls);
    }
  }

  const toolCalls = toolAcc
    .filter(Boolean)
    .map((call, i) => ({
      id: call.id || `call_${Date.now()}_${i}`,
      type: 'function',
      function: { name: call.function.name, arguments: call.function.arguments || '{}' }
    }))
    .filter((c) => c.function.name);

  return { content, toolCalls, finishReason, usage };
}

/** Non-streaming fallback (used when a provider ignores stream=true). */
async function completeChat({ baseUrl, apiKey, model, messages, tools, signal, temperature = 0.2, maxTokens = 4096 }) {
  const base = normalizeBase(baseUrl);
  const url = /\/chat\/completions$/i.test(base) ? base : base + '/chat/completions';
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const body = { model, messages, temperature, stream: false, max_tokens: maxTokens };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw friendlyError(res.status, await res.text().catch(() => ''));
  const json = await res.json();
  const msg = json.choices?.[0]?.message || {};
  return { content: msg.content || '', toolCalls: msg.tool_calls || [], finishReason: json.choices?.[0]?.finish_reason || 'stop', usage: json.usage || null };
}

/** Ask the provider for the list of available models (best effort). */
async function listModels({ baseUrl, apiKey }) {
  const base = normalizeBase(baseUrl);
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const res = await fetch(base + '/models', { headers });
  if (!res.ok) throw friendlyError(res.status, await res.text().catch(() => ''));
  const json = await res.json();
  return (json.data || []).map((m) => m.id).filter(Boolean).sort();
}

module.exports = { PRESETS, streamChat, completeChat, listModels, ProviderError };

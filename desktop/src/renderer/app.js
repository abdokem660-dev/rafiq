/* ═══════════════════════════════════════════════════════════════════
   RAFIQ — renderer
   Works both inside Electron (IPC bridge) and in a browser against the
   local server (/api/*). No dependencies, no frameworks.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const desktop = window.rafiqDesktop || null;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── state ─────────────────────────────────────────────────── */
  const state = {
    info: {},
    settings: {},
    presets: [],
    sessions: [],
    recents: [],
    workspace: { root: null, name: null },
    mode: 'plan',
    busy: false,
    canUndo: false,
    sessionId: null,
    keyDirty: false,
    attachments: [],
    openFile: null,
    approval: null,
    browser: !desktop
  };

  const LS = 'rafiq.ui';
  const ui = (() => {
    try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; }
  })();

  function saveUI(patch) {
    Object.assign(ui, patch);
    try { localStorage.setItem(LS, JSON.stringify(ui)); } catch {}
  }

  /* ── API layer ─────────────────────────────────────────────── */
  const api = {
    async invoke(channel, payload) {
      if (desktop) {
        const res = await desktop.invoke(channel, payload);
        if (res && res.__error) throw new Error(res.__error);
        return res;
      }
      const routes = {
        'state': ['GET', '/api/state'],
        'workspace:open': ['POST', '/api/workspace'],
        'workspace:tree': null,
        'workspace:read': null,
        'workspace:write': ['POST', '/api/file'],
        'settings:set': ['POST', '/api/settings'],
        'session:new': ['POST', '/api/session/new'],
        'session:load': ['POST', '/api/session/load'],
        'session:delete': ['POST', '/api/session/delete'],
        'chat:send': ['POST', '/api/chat'],
        'chat:cancel': ['POST', '/api/cancel'],
        'chat:mode': ['POST', '/api/mode'],
        'chat:approve': ['POST', '/api/approve'],
        'chat:plan:approve': ['POST', '/api/plan/approve'],
        'models:list': ['POST', '/api/models'],
        'workspace:undo': ['POST', '/api/undo'],
        'session:list': ['GET', '/api/state']
      };
      const route = routes[channel];
      if (!route) throw new Error('Not available in browser mode: ' + channel);
      const [method, url] = route;
      const res = await fetch(url + (method === 'GET' ? '?' + new URLSearchParams(payload || {}) : ''), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
      // normalise to the shapes the IPC bridge returns
      if (channel === 'settings:set') return data.settings;
      if (channel === 'session:new') return data.state;
      return data;
    },
    async tree(path) {
      if (desktop) return api.invoke('workspace:tree', { path });
      const res = await fetch('/api/tree?path=' + encodeURIComponent(path || ''));
      return (await res.json()).nodes || [];
    },
    async readFile(path) {
      if (desktop) return api.invoke('workspace:read', { path });
      const res = await fetch('/api/file?path=' + encodeURIComponent(path));
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.file;
    },
    onEvent(fn) {
      if (desktop) {
        desktop.onEvent((event) => {
          if (event.type === 'menu') handleMenu(event.action);
          else fn(event);
        });
      } else {
        const es = new EventSource('/api/events');
        es.onmessage = (msg) => {
          try { fn(JSON.parse(msg.data)); } catch (err) { console.error(err); }
        };
        es.onerror = () => setStatus('offline', 'Reconnecting…');
      }
    }
  };

  /* ── i18n ──────────────────────────────────────────────────── */
  const AR = {
    'brand.tag': 'وكيل محلي',
    'ws.none': 'مفيش مجلد مفتوح',
    'session.new': 'جلسة جديدة',
    'session.recent': 'الجلسات الأخيرة',
    'side.workspaces': 'مجلدات حديثة',
    'side.settings': 'الإعدادات',
    'mode.plan': 'خطّط',
    'mode.build': 'نفّذ',
    'mode.discuss': 'ناقش',
    'undo': 'تراجع عن التغييرات',
    'files': 'الملفات',
    'welcome.title': 'نبني إيه النهاردة؟',
    'welcome.sub': 'رَفِيق بيشتغل جوه المجلد اللي تفتحه بس. ومفتاحك على جهازك.',
    'welcome.step1': 'افتح مجلد',
    'welcome.step2': 'حط مفتاحك في الإعدادات',
    'welcome.step3': 'اشرح الهدف',
    'quick.map.title': 'اعمل خريطة للمشروع',
    'quick.map.sub': 'الهيكل ونقط البداية وطريقة التشغيل',
    'quick.improve.title': 'اقترح تحسينات',
    'quick.improve.sub': 'مرتبة بالأولوية ومع الأسباب',
    'quick.test.title': 'شغّل واصلّح الاختبارات',
    'quick.test.sub': 'بناء، اختبار، إصلاح',
    'quick.explain.title': 'اشرح الكود',
    'quick.explain.sub': 'شرح مبسّط خطوة بخطوة',
    'composer.ph': 'اشرح هدف أو اسأل سؤال أو الصق رسالة خطأ…',
    'composer.attach': 'إرفاق',
    'composer.send': 'إرسال',
    'composer.newline': 'سطر جديد',
    'composer.stop': 'إيقاف',
    'composer.fine': 'رَفِيق بيغلط أحيانًا. راجع التغييرات قبل ما تنشر — واستخدم التراجع لو الجولة باظت.',
    'explorer.title': 'الملفات',
    'settings.title': 'الإعدادات',
    'settings.model': 'مزوّد الموديل',
    'settings.modelNote': 'رَفِيق بيكلم أي API متوافق مع OpenAI. مفتاحك متخزّن على الجهاز ده بس.',
    'settings.provider': 'المزوّد',
    'settings.baseUrl': 'عنوان API',
    'settings.apiKey': 'مفتاح API',
    'settings.show': 'إظهار',
    'settings.hide': 'إخفاء',
    'settings.keyHint': 'متخزّن في مجلد بيانات رَفِيق على جهازك، ومحمي بحساب ويندوز بتاعك.',
    'settings.modelName': 'الموديل',
    'settings.fetch': 'جيب القائمة',
    'settings.temp': 'الإبداع',
    'settings.safety': 'الأمان',
    'settings.confirmCmd': 'اسألني قبل تنفيذ الأوامر',
    'settings.confirmCmdNote': 'مستحسن. بتشوف كل أمر قبل تنفيذه.',
    'settings.danger': 'اسمح بالأوامر الخطيرة',
    'settings.dangerNote': 'بيفتح أوامر القرص والريجستري. سيبها مقفولة إلا لو متأكد.',
    'settings.backups': 'احفظ نسخة من الملفات كل جولة',
    'settings.backupsNote': 'بيخلي زر التراجع قادر يرجّع الملفات زي ما كانت.',
    'settings.general': 'عام',
    'settings.lang': 'اللغة',
    'settings.theme': 'الثيم',
    'settings.dark': 'داكن',
    'settings.light': 'فاتح',
    'settings.name': 'اسمك (اختياري)',
    'settings.close': 'إغلاق',
    'settings.save': 'حفظ',
    'approval.deny': 'رفض',
    'approval.allow': 'نفّذ',
    'ws.choose': 'افتح مجلد مشروع',
    'ws.browserNote': 'الصق مسار مجلد على الجهاز ده. رَفِيق مش هيقرأ أي حاجة برّاه.',
    'ws.open': 'افتح المجلد',
    'help.title': 'إزاي رَفِيق بيشتغل',
    'help.s1t': 'افتح مجلد.',
    'help.s1b': 'رَفِيق يقدر يقرأ ويكتب جوه المجلد ده بس. أي حاجة تانية على جهازك بعيدة عنه.',
    'help.s2t': 'حط مفتاحك.',
    'help.s2b': 'الإعدادات ← اختار مزوّد ← الصق مفتاح API. بيتخزن على الجهاز ده بس وبيتبعت للمزوّد مباشرة.',
    'help.s3t': 'خطّط الأول.',
    'help.s3b': 'في وضع التخطيط رَفِيق بيقرأ الكود ويطلع خطة. وافق عليها يتحوّل للتنفيذ، أو اتكلم في وضع المناقشة.',
    'help.s4t': 'خليك آمن.',
    'help.s4b': 'الأوامر محتاجة موافقتك، والعمليات الخطيرة مقفولة، وأي تغيير في الملفات ينفع تتراجع عنه.',
    'help.keys': 'اختصارات',
    'help.k1': 'إرسال الرسالة',
    'help.k2': 'سطر جديد',
    'help.k3': 'جلسة جديدة',
    'help.k4': 'فتح مجلد',
    'help.k5': 'الإعدادات',
    'help.k6': 'إيقاف الوكيل',
    'help.footer': 'رَفِيق مفتوح المصدر — github.com/abdokem660-dev/rafiq',
    'status.ready': 'جاهز',
    'status.working': 'بيشتغل…',
    'status.offline': 'غير متصل',
    'msg.you': 'أنت',
    'msg.rafiq': 'رَفِيق',
    'plan.label': 'الخطة',
    'plan.approve': 'وافق ونفّذ',
    'plan.revise': 'عايز تعديل',
    'plan.copy': 'نسخ',
    'undo.done': 'تم استرجاع الملفات',
    'tool.running': 'بيشتغل',
    'tool.done': 'خلص',
    'tool.failed': 'فشل',
    'action.copy': 'نسخ',
    'action.retry': 'إعادة',
    'approx': 'تقريبًا',
    'confirm.deleteSession': 'تحذف الجلسة دي؟',
    'key.missing': 'ضيف مفتاح API من الإعدادات الأول.',
    'ws.missing': 'افتح مجلد الأول.',
    'settings.saved': 'تم الحفظ',
    'model.pick': 'اختار موديل',
    'files.empty': 'المجلد فاضي',
    'chat.stopped': 'اتوقف بطلبك'
  };

  const EN = {
    'settings.hide': 'Hide',
    'files.empty': 'This folder is empty',
    'status.ready': 'Ready',
    'status.working': 'Working…',
    'status.offline': 'Offline',
    'msg.you': 'You',
    'msg.rafiq': 'Rafiq',
    'plan.label': 'Plan',
    'plan.approve': 'Approve & build',
    'plan.revise': 'Ask for changes',
    'plan.copy': 'Copy',
    'undo.done': 'Files restored',
    'action.copy': 'Copy',
    'confirm.deleteSession': 'Delete this session?',
    'key.missing': 'Add your API key in Settings first (it stays on this device).',
    'ws.missing': 'Open a folder first.',
    'settings.saved': 'Saved',
    'chat.stopped': 'Stopped at your request'
  };
  function captureEN() {
    $$('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!(key in EN)) EN[key] = el.textContent;
    });
    $$('[data-i18n-ph]').forEach((el) => {
      if (!(el.dataset.enPh)) el.dataset.enPh = el.placeholder;
    });
  }

  let lang = ui.lang || 'en';

  function t(key, fallback) {
    const table = lang === 'ar' ? AR : EN;
    return table[key] || EN[key] || fallback || key;
  }

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    $$('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const value = lang === 'ar' ? (AR[key] || EN[key]) : EN[key];
      if (value != null) el.textContent = value;
    });
    $$('[data-i18n-ph]').forEach((el) => {
      el.placeholder = lang === 'ar' ? (AR[el.getAttribute('data-i18n-ph')] || el.dataset.enPh) : el.dataset.enPh;
    });
    $('#lang-label').textContent = lang === 'ar' ? 'EN' : 'عربي';
    $('#input').placeholder = lang === 'ar' ? AR['composer.ph'] : EN['composer.ph'];
    setStatus(state.busy ? 'working' : 'ready');
    renderSessions();
    renderRecents();
    if ($('#file-view').hidden === false && state.openFile) $('#file-name').textContent = state.openFile;
    saveUI({ lang });
  }

  function applyTheme() {
    const theme = ui.theme || 'dark';
    document.documentElement.dataset.theme = theme;
    $('#ic-sun').style.display = theme === 'dark' ? 'none' : 'block';
    $('#ic-moon').style.display = theme === 'dark' ? 'block' : 'none';
  }

  /* ── tiny markdown ─────────────────────────────────────────── */
  function inline(text) {
    let out = esc(text);
    out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    return out;
  }

  function markdown(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inCode = false;
    let codeLang = '';
    let code = [];
    let list = null;

    const closeList = () => {
      if (list) { out.push(`</${list}>`); list = null; }
    };

    for (const raw of lines) {
      const line = raw.replace(/\t/g, '  ');
      const fence = line.match(/^\s*```(\w+)?\s*$/);
      if (fence) {
        if (inCode) {
          out.push(`<pre><code data-lang="${esc(codeLang)}">${esc(code.join('\n'))}</code></pre>`);
          inCode = false; code = []; codeLang = '';
        } else {
          closeList();
          inCode = true; codeLang = fence[1] || '';
        }
        continue;
      }
      if (inCode) { code.push(raw); continue; }

      if (!line.trim()) { closeList(); continue; }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = Math.min(heading[1].length + 1, 4);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      if (/^\s*([-*_]){3,}\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
      if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }

      const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ol || ul) {
        const want = ol ? 'ol' : 'ul';
        if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
        const item = ol ? ol[2] : ul[1];
        out.push(`<li>${inline(item || '')}</li>`);
        continue;
      }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    if (inCode) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    closeList();
    return out.join('\n');
  }

  /* ── dom helpers ───────────────────────────────────────────── */
  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch {}
      area.remove();
    }
    toast('Copied', 'ok');
  }

  function toast(text, kind = '') {
    const node = el('div', 'toast ' + kind, esc(text));
    $('#toasts').appendChild(node);
    setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateY(6px)'; }, 3200);
    setTimeout(() => node.remove(), 3600);
  }

  let statusOverride = null;
  function setStatus(kind, text) {
    const dot = $('#status-dot');
    const label = $('#status-text');
    if (kind === 'busy') { dot.className = 'status-dot busy'; label.textContent = text || t('status.working'); }
    else if (kind === 'error') { dot.className = 'status-dot error'; label.textContent = text || 'Error'; }
    else if (kind === 'offline') { dot.className = 'status-dot error'; label.textContent = text || t('status.offline'); }
    else { dot.className = 'status-dot'; label.textContent = text || t('status.ready'); }
  }

  /* ── sessions sidebar ──────────────────────────────────────── */
  function relTime(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
  }

  function renderSessions() {
    const list = $('#session-list');
    list.innerHTML = '';
    $('#session-count').textContent = String(state.sessions.length);
    if (!state.sessions.length) {
      list.appendChild(el('div', 'notice', lang === 'ar' ? 'مفيش جلسات لسه' : 'No sessions yet'));
      return;
    }
    state.sessions.forEach((session) => {
      const row = el('div', 'session-item' + (session.id === state.sessionId ? ' active' : ''));
      row.innerHTML = `
        <span class="s-title"></span>
        <span class="s-meta"></span>
        <button class="s-del" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
      $('.s-title', row).textContent = session.title || 'Session';
      $('.s-meta', row).textContent = relTime(session.updatedAt);
      $('.s-title', row).addEventListener('click', () => openSession(session.id));
      row.addEventListener('click', (e) => { if (!e.target.closest('.s-del')) openSession(session.id); });
      $('.s-del', row).addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(t('confirm.deleteSession'))) return;
        const res = await api.invoke('session:delete', { id: session.id });
        state.sessions = res.sessions || [];
        renderSessions();
        if (state.sessionId === session.id) newSession();
      });
      list.appendChild(row);
    });
  }

  function renderRecents() {
    const box = $('#recent-list');
    box.innerHTML = '';
    if (!state.recents.length) {
      box.appendChild(el('div', 'notice', lang === 'ar' ? 'لسه مفيش مجلدات' : 'No folders yet'));
    }
    state.recents.slice(0, 6).forEach((folder) => {
      const item = el('button', 'recent-item');
      item.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span></span>';
      $('span', item).textContent = folder;
      item.title = folder;
      item.addEventListener('click', async () => {
        try {
          const res = await api.invoke('workspace:open', { path: folder });
          onWorkspace(res.workspace, res.recents);
        } catch (err) { toast(err.message, 'err'); }
      });
      box.appendChild(item);
    });
  }

  /* ── workspace + explorer ──────────────────────────────────── */
  function onWorkspace(info, recents) {
    const previous = state.workspace.root;
    state.workspace = info || { root: null, name: null };
    $('#ws-path').textContent = state.workspace.root || (lang === 'ar' ? 'اختار مشروع…' : 'Choose a project…');
    $('.ws-label').textContent = state.workspace.name || t('ws.none');
    if (recents) state.recents = recents;
    renderRecents();
    if (state.workspace.root !== previous || !$('#file-tree').childElementCount) loadTree();
    if (state.browser) $('#modal-workspace').hidden = true;
  }

  async function chooseWorkspace() {
    if (desktop) {
      const res = await api.invoke('workspace:choose');
      if (res && !res.canceled) onWorkspace(res.workspace, res.recents);
      return;
    }
    $('#modal-workspace').hidden = false;
    $('#ws-input').focus();
    const box = $('#ws-recents');
    box.innerHTML = '';
    state.recents.forEach((folder) => {
      const item = el('button', 'recent-item');
      item.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span></span>';
      $('span', item).textContent = folder;
      item.addEventListener('click', () => { $('#ws-input').value = folder; });
      box.appendChild(item);
    });
  }

  const FOLDER_ICON = '<svg class="t-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const FILE_ICON = '<svg class="t-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';

  async function loadTree() {
    if (!state.workspace.root) {
      $('#file-tree').innerHTML = `<div class="notice">${lang === 'ar' ? 'افتح مجلد الأول' : 'Open a folder to browse files'}</div>`;
      return;
    }
    $('#file-tree').innerHTML = '<div class="notice">…</div>';
    try {
      const nodes = await api.tree('');
      $('#file-tree').innerHTML = '';
      if (!nodes.length) { $('#file-tree').innerHTML = `<div class="notice">${t('files.empty')}</div>`; return; }
      const walk = (items, parent) => {
        items.forEach((node) => {
          const row = el('button', 'tree-row ' + (node.type === 'dir' ? 'dir' : 'file'));
          row.innerHTML = (node.type === 'dir' ? FOLDER_ICON : FILE_ICON) +
            '<span class="t-name"></span>' +
            (node.type === 'file' ? '<span class="t-size"></span>' : '');
          $('.t-name', row).textContent = node.name;
          if (node.type === 'file') $('.t-size', row).textContent = (node.size / 1024).toFixed(node.size < 1024 ? 1 : 0) + 'k';
          parent.appendChild(row);

          if (node.type === 'dir') {
            const kids = el('div', 'tree-children');
            kids.hidden = true;
            parent.appendChild(kids);
            row.addEventListener('click', () => {
              kids.hidden = !kids.hidden;
              row.classList.toggle('active', !kids.hidden);
            });
            walk(node.children || [], kids);
          } else {
            row.addEventListener('click', () => openFile(node.path, row));
          }
        });
      };
      walk(nodes, $('#file-tree'));
    } catch (err) {
      $('#file-tree').innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
  }

  async function openFile(path, row) {
    try {
      const file = await api.readFile(path);
      state.openFile = path;
      $('#file-view').hidden = false;
      $('#file-name').textContent = path;
      $('#file-code').textContent = file.content;
      $$('.tree-row').forEach((r) => r.classList.remove('active'));
      if (row) row.classList.add('active');
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ── transcript rendering ──────────────────────────────────── */
  const messages = () => $('#messages');

  function hideWelcome(hide) {
    $('#welcome').classList.toggle('hidden', hide);
  }

  function scrollChat() {
    const chat = $('#chat');
    chat.scrollTop = chat.scrollHeight + 400;
  }

  function addUserMessage(text, attachments) {
    hideWelcome(true);
    const node = el('div', 'msg user');
    node.innerHTML = `
      <div class="msg-avatar">${esc((state.settings.userName || 'Y').charAt(0).toUpperCase())}</div>
      <div class="msg-body">
        <div class="msg-role">${esc(t('msg.you'))}</div>
        <div class="msg-content"></div>
        <div class="msg-actions"></div>
      </div>`;
    $('.msg-content', node).textContent = text;
    if (attachments && attachments.length) {
      const chips = el('div', 'attachments');
      attachments.forEach((p) => chips.appendChild(el('span', 'attachment', `<span>${esc(p)}</span>`)));
      $('.msg-body', node).insertBefore(chips, $('.msg-actions', node));
    }
    const copy = el('button', 'tiny-btn', t('action.copy'));
    copy.addEventListener('click', () => { copyText(text); });
    $('.msg-actions', node).appendChild(copy);
    messages().appendChild(node);
    scrollChat();
  }

  let lastAssistantNode = null;

  function addAssistantMessage(content) {
    const node = el('div', 'msg assistant');
    node.innerHTML = `
      <div class="msg-avatar"><img src="logo.svg" alt=""></div>
      <div class="msg-body">
        <div class="msg-role">${esc(t('msg.rafiq'))}</div>
        <div class="msg-content"></div>
        <div class="msg-actions"></div>
      </div>`;
    $('.msg-content', node).innerHTML = markdown(content || '');
    const copy = el('button', 'tiny-btn', t('action.copy'));
    copy.addEventListener('click', () => { copyText(content || ''); });
    $('.msg-actions', node).appendChild(copy);
    messages().appendChild(node);
    lastAssistantNode = node;
    scrollChat();
    return node;
  }

  function addError(message) {
    const node = el('div', 'msg-error', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><div></div>');
    $('div', node).textContent = message;
    messages().appendChild(node);
    scrollChat();
  }

  const TOOL_ICONS = {
    read_file: 'R', list_dir: 'L', search_files: 'S', write_file: 'W', edit_file: 'E',
    run_command: '$', make_dir: 'D', delete_path: 'X', move_path: 'M'
  };
  const TOOL_LABELS = {
    read_file: 'Read file', list_dir: 'List folder', search_files: 'Search', write_file: 'Write file',
    edit_file: 'Edit file', run_command: 'Run command', make_dir: 'Create folder',
    delete_path: 'Delete', move_path: 'Move'
  };
  const liveTools = new Map();

  function addToolCard(name, args) {
    const card = el('div', `tool-card running`);
    card.dataset.toolId = name + Math.random();
    const cmd = name === 'run_command' ? (args.command || '') : (args.path || args.from || args.query || '');
    card.innerHTML = `
      <button class="tool-head">
        <span class="tool-ico">${esc(TOOL_ICONS[name] || '•')}</span>
        <span class="tool-name">${esc(TOOL_LABELS[name] || name)}</span>
        <span class="tool-summary"></span>
        <span class="tool-time"></span>
        <svg class="tool-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <div class="tool-body"><pre></pre></div>`;
    $('.tool-summary', card).textContent = cmd;
    $('.tool-summary', card).title = cmd;
    $('.tool-body pre', card).textContent = cmd ? `$ ${cmd}` : '';
    $('.tool-head', card).addEventListener('click', () => card.classList.toggle('open'));
    messages().appendChild(card);
    scrollChat();
    return card;
  }

  function finishToolCard(card, { ok, summary, output, ms }) {
    if (!card) return;
    card.classList.remove('running');
    card.classList.add(ok ? 'ok' : 'fail');
    if (summary) { $('.tool-summary', card).textContent = summary; $('.tool-summary', card).title = summary; }
    if (ms != null) $('.tool-time', card).textContent = ms > 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
    if (output) $('.tool-body pre', card).textContent = output;
    $('.tool-ico', card).textContent = ok ? '✓' : '✕';
    scrollChat();
  }

  function addPlanCard(content) {
    const card = el('div', 'plan-card');
    card.innerHTML = `
      <div class="plan-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        ${esc(t('plan.label'))}
      </div>
      <div class="plan-body"></div>
      <div class="plan-actions">
        <button class="btn-primary act-build"></button>
        <button class="btn-ghost act-revise"></button>
        <button class="btn-ghost act-copy"></button>
      </div>`;
    $('.plan-body', card).innerHTML = markdown(content);
    $('.act-build', card).textContent = t('plan.approve');
    $('.act-revise', card).textContent = t('plan.revise');
    $('.act-copy', card).textContent = t('plan.copy');
    $('.act-copy', card).addEventListener('click', () => { copyText(content); });
    $('.act-build', card).addEventListener('click', async () => {
      try {
        await api.invoke('chat:plan:approve', { plan: content });
        setMode('build');
        const input = $('#input');
        input.value = lang === 'ar' ? 'نفّذ الخطة دي.' : 'Go ahead and build this plan.';
        input.focus();
        autoGrow();
        toast(lang === 'ar' ? 'الخطة اتوافقت — ابعتها للتنفيذ' : 'Plan approved — send it to start building', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
    $('.act-revise', card).addEventListener('click', () => {
      const input = $('#input');
      input.value = lang === 'ar' ? 'عدّل الخطة: ' : 'Revise the plan: ';
      input.focus();
      autoGrow();
    });
    messages().appendChild(card);
    scrollChat();
  }

  function renderTranscript(entries, plans, mode) {
    messages().innerHTML = '';
    liveTools.clear();
    if (!entries || !entries.length) { hideWelcome(false); return; }
    hideWelcome(true);
    const lastPlan = plans && plans.length ? plans[plans.length - 1] : null;
    const lastAssistant = [...entries].reverse().find((e) => e.t === 'assistant');
    entries.forEach((entry) => {
      if (entry.t === 'user') addUserMessage(entry.content, entry.attachments);
      else if (entry.t === 'assistant') {
        const isPlan = lastPlan && mode === 'plan' && lastAssistant && entry === lastAssistant && entry.content === lastPlan.content;
        if (isPlan) addPlanCard(entry.content);
        else addAssistantMessage(entry.content);
      } else if (entry.t === 'tool') {
        const card = addToolCard(entry.name, entry.args || {});
        finishToolCard(card, entry);
      } else if (entry.t === 'error') addError(entry.content);
      else if (entry.t === 'notice') messages().appendChild(el('div', 'notice', esc(entry.content)));
    });
    scrollChat();
  }

  /* ── streaming ─────────────────────────────────────────────── */
  let liveAssistant = null;
  let liveText = '';
  let renderTimer = null;

  function startAssistant() {
    liveText = '';
    liveAssistant = el('div', 'msg assistant');
    liveAssistant.innerHTML = `
      <div class="msg-avatar"><img src="logo.svg" alt=""></div>
      <div class="msg-body">
        <div class="msg-role">${esc(t('msg.rafiq'))}</div>
        <div class="msg-content cursor-blink"></div>
      </div>`;
    messages().appendChild(liveAssistant);
    hideWelcome(true);
    scrollChat();
  }

  function pushDelta(delta) {
    if (!liveAssistant) startAssistant();
    liveText += delta;
    const box = $('.msg-content', liveAssistant);
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        if (!liveAssistant) return;
        box.innerHTML = markdown(liveText);
        scrollChat();
      }, 80);
    }
  }

  function endAssistant(content) {
    if (!liveAssistant) {
      if (content) addAssistantMessage(content);
      return;
    }
    const box = $('.msg-content', liveAssistant);
    box.classList.remove('cursor-blink');
    box.innerHTML = markdown(content != null ? content : liveText);
    if (liveAssistant) {
      const actions = el('div', 'msg-actions');
      const copy = el('button', 'tiny-btn', t('action.copy'));
      copy.addEventListener('click', () => { copyText(liveText); });
      actions.appendChild(copy);
      $('.msg-body', liveAssistant).appendChild(actions);
      lastAssistantNode = liveAssistant;
    }
    liveAssistant = null;
    liveText = '';
    scrollChat();
  }

  /* ── modes ─────────────────────────────────────────────────── */
  function setMode(mode, fromEvent) {
    state.mode = mode;
    $$('.mode').forEach((btn) => btn.setAttribute('aria-selected', btn.dataset.mode === mode ? 'true' : 'false'));
    if (!fromEvent) api.invoke('chat:mode', { mode }).catch(() => {});
    const hints = {
      plan: lang === 'ar' ? 'رَفِيق بيقرأ ويخطط بس — مفيش تعديل.' : 'Rafiq reads and plans only — no edits.',
      build: lang === 'ar' ? 'رَفِيق بيعدّل الملفات ويشغّل الأوامر.' : 'Rafiq edits files and runs commands.',
      discuss: lang === 'ar' ? 'اسأل عن الكود — قراءة فقط.' : 'Ask about the code — read only.'
    };
    setStatus(state.busy ? 'busy' : 'ready');
    $('#status-text').title = hints[mode] || '';
  }

  /* ── busy state ────────────────────────────────────────────── */
  function setBusy(busy) {
    state.busy = busy;
    $('#btn-send').disabled = busy;
    $('#btn-stop').hidden = !busy;
    $('#input').disabled = busy;
    setStatus(busy ? 'busy' : 'ready');
    if (!busy) { $('#input').disabled = false; $('#input').focus(); }
  }

  async function sendMessage(textArg) {
    const input = $('#input');
    const text = (textArg != null ? textArg : input.value).trim();
    if (!text) return;
    if (!state.workspace.root) { toast(t('ws.missing'), 'err'); chooseWorkspace(); return; }
    if (!state.settings.hasKey && !/127\.0\.0\.1|localhost/.test(state.settings.baseUrl || '')) {
      toast(t('key.missing'), 'err');
      openSettings();
      return;
    }
    input.value = '';
    autoGrow();
    addUserMessage(text, state.attachments.map((a) => a.path));
    const attachments = state.attachments.slice();
    state.attachments = [];
    renderAttachments();
    setBusy(true);
    startAssistant();
    try {
      await api.invoke('chat:send', { text, mode: state.mode, attachments });
    } catch (err) {
      setBusy(false);
      if (liveAssistant) { liveAssistant.remove(); liveAssistant = null; liveText = ''; }
      addError(err.message);
    }
  }

  /* ── events from the agent ─────────────────────────────────── */
  function handleEvent(event) {
    switch (event.type) {
      case 'assistant:start':
        if (!liveAssistant) startAssistant();
        break;
      case 'assistant:delta':
        pushDelta(event.text || '');
        break;
      case 'assistant:end':
        endAssistant(event.content);
        break;
      case 'tool:start': {
        const card = addToolCard(event.name, event.args || {});
        liveTools.set(event.id, card);
        if (event.name === 'run_command') setStatus('busy', event.args?.command || t('status.working'));
        break;
      }
      case 'tool:end': {
        const card = liveTools.get(event.id);
        finishToolCard(card, event);
        liveTools.delete(event.id);
        setStatus(state.busy ? 'busy' : 'ready');
        break;
      }
      case 'command:output':
        break;
      case 'plan':
        endAssistant();
        if (lastAssistantNode && lastAssistantNode.parentElement) {
          lastAssistantNode.remove();
          lastAssistantNode = null;
        }
        addPlanCard(event.content);
        break;
      case 'error':
        addError(event.message);
        setBusy(false);
        setStatus('error');
        break;
      case 'notice':
        toast(event.text, event.level || '');
        break;
      case 'busy':
        setBusy(Boolean(event.busy));
        break;
      case 'turn:end':
        setBusy(false);
        break;
      case 'workspace':
        onWorkspace(event.workspace, null);
        break;
      case 'workspace:changed':
        if (!$('#explorer').hidden) loadTree();
        break;
      case 'mode':
        setMode(event.mode, true);
        break;
      case 'session':
        applyState(event.state);
        break;
      case 'settings':
        state.settings = event.settings;
        paintSettings();
        break;
      case 'approval':
        showApproval(event);
        break;
      case 'approval:expired':
        toast(lang === 'ar' ? 'انتهت مدة الموافقة' : 'Approval expired', 'err');
        break;
      case 'usage':
        break;
      case 'transcript':
        break;
      case 'menu':
        handleMenu(event.action);
        break;
      default:
        break;
    }
  }

  function applyState(next) {
    if (!next) return;
    state.busy = Boolean(next.busy);
    state.canUndo = Boolean(next.canUndo);
    state.sessionId = next.sessionId;
    state.mode = next.mode || state.mode;
    if (next.workspace) onWorkspace(next.workspace, null);
    $$('.mode').forEach((btn) => btn.setAttribute('aria-selected', btn.dataset.mode === state.mode ? 'true' : 'false'));
    $('#btn-undo').hidden = !state.canUndo;
    $('#btn-send').disabled = state.busy;
    $('#btn-stop').hidden = !state.busy;
    renderSessions();
  }

  /* ── approval modal ────────────────────────────────────────── */
  function showApproval(event) {
    state.approval = event;
    $('#approval-title').textContent = event.title || 'Approve?';
    $('#approval-reason').textContent = event.reason || '';
    $('#approval-detail').textContent = event.detail || '';
    $('#approval-warn').hidden = !event.dangerous;
    $('#approval-warn').textContent = event.dangerous
      ? (lang === 'ar' ? 'تحذير: الأمر ده خطير وممكن يضر جهازك.' : 'Warning: this command is on Rafiq\'s dangerous list. Only allow it if you truly mean it.')
      : '';
    $('#modal-approval').hidden = false;
    $('#btn-allow').focus();
  }

  async function answerApproval(allow) {
    const pending = state.approval;
    state.approval = null;
    $('#modal-approval').hidden = true;
    if (pending) await api.invoke('chat:approve', { id: pending.id, allow }).catch(() => {});
  }

  /* ── settings ──────────────────────────────────────────────── */
  function paintSettings() {
    const s = state.settings;
    const select = $('#set-provider');
    select.innerHTML = '';
    state.presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      select.appendChild(option);
    });
    if (!state.presets.some((p) => p.id === s.provider)) {
      const option = document.createElement('option');
      option.value = s.provider || 'custom';
      option.textContent = s.provider || 'custom';
      select.appendChild(option);
    }
    select.value = s.provider || 'custom';
    $('#set-baseurl').value = s.baseUrl || '';
    $('#set-model').value = s.model || '';
    $('#set-apikey').value = '';
    $('#set-apikey').placeholder = s.hasKey ? '••••••••••••••• (saved)' : 'sk-…';
    $('#key-hint').textContent = s.hasKey
      ? (lang === 'ar' ? 'فيه مفتاح متخزّن. اكتب مفتاح جديد لو عايز تغيّره.' : 'A key is saved. Type a new one only if you want to replace it.')
      : t('settings.keyHint');
    $('#set-temp').value = s.temperature ?? 0.2;
    $('#temp-out').textContent = Number(s.temperature ?? 0.2).toFixed(1);
    $('#set-approve-commands').checked = s.requireCommandApproval !== false;
    $('#set-dangerous').checked = Boolean(s.allowDangerousCommands);
    $('#btn-toggle-key').textContent = t('settings.show');
    $('#set-apikey').type = 'password';
    $('#set-lang').value = lang;
    $('#set-theme').value = ui.theme || 'dark';
    $('#set-name').value = s.userName || '';
    paintModelOptions();
    $('#model-label').textContent = s.model || 'no model';
  }

  function paintModelOptions() {
    const preset = state.presets.find((p) => p.id === ($('#set-provider').value));
    const list = $('#model-options');
    list.innerHTML = '';
    (preset?.models || []).forEach((m) => {
      const option = document.createElement('option');
      option.value = m;
      list.appendChild(option);
    });
  }

  function openSettings() {
    paintSettings();
    $('#modal-settings').hidden = false;
    $('#save-state').textContent = '';
  }

  async function saveSettings() {
    const patch = {
      provider: $('#set-provider').value,
      baseUrl: $('#set-baseurl').value.trim(),
      model: $('#set-model').value.trim(),
      temperature: Number($('#set-temp').value),
      requireCommandApproval: $('#set-approve-commands').checked,
      allowDangerousCommands: $('#set-dangerous').checked,
      userName: $('#set-name').value.trim()
    };
    if (state.keyDirty) patch.apiKey = $('#set-apikey').value.trim();
    try {
      const settings = await api.invoke('settings:set', patch);
      state.settings = settings;
      state.keyDirty = false;
      saveUI({ theme: $('#set-theme').value, lang: $('#set-lang').value });
      lang = $('#set-lang').value;
      applyTheme();
      applyLang();
      paintSettings();
      $('#save-state').textContent = '✓ ' + t('settings.saved');
      setTimeout(() => { $('#save-state').textContent = ''; }, 2500);
      toast(t('settings.saved'), 'ok');
      if (lang !== (ui.lang || 'en')) applyLang();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function fetchModels() {
    const btn = $('#btn-fetch-models');
    btn.disabled = true;
    toast(lang === 'ar' ? 'بنجيب الموديلات…' : 'Fetching models…');
    try {
      const res = await api.invoke('models:list', {
        baseUrl: $('#set-baseurl').value.trim(),
        apiKey: state.keyDirty ? $('#set-apikey').value.trim() : ''
      });
      const list = $('#model-options');
      list.innerHTML = '';
      (res.models || []).forEach((m) => {
        const option = document.createElement('option');
        option.value = m;
        list.appendChild(option);
      });
      toast((res.models || []).length + ' models', 'ok');
    } catch (err) {
      toast(err.message || 'Could not fetch models', 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /* ── composer ──────────────────────────────────────────────── */
  function autoGrow() {
    const input = $('#input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  }

  function renderAttachments() {
    const box = $('#attachments');
    box.innerHTML = '';
    state.attachments.forEach((att, i) => {
      const chip = el('div', 'attachment', `<span>${esc(att.path)}</span><button title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`);
      $('button', chip).addEventListener('click', () => { state.attachments.splice(i, 1); renderAttachments(); });
      box.appendChild(chip);
    });
  }

  async function attachOpenFile() {
    if (!state.openFile) {
      toast(lang === 'ar' ? 'افتح ملف من لوحة الملفات الأول' : 'Open a file in the Files panel first', 'err');
      return;
    }
    if (state.attachments.some((a) => a.path === state.openFile)) return;
    try {
      const file = await api.readFile(state.openFile);
      state.attachments.push({ path: file.path, content: file.content });
      renderAttachments();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ── menu ──────────────────────────────────────────────────── */
  async function handleMenu(action) {
    if (action === 'new-session') newSession();
    if (action === 'open-folder') { try { await chooseWorkspace(); } catch (err) { toast(err.message, 'err'); } }
    if (action === 'settings') openSettings();
    if (action === 'toggle-theme') { saveUI({ theme: (ui.theme === 'light' ? 'dark' : 'light') }); applyTheme(); }
    if (action === 'toggle-lang') { lang = lang === 'ar' ? 'en' : 'ar'; applyLang(); }
    if (action === 'toggle-sidebar') $('#app').classList.toggle('sidebar-hidden');
    if (action === 'undo-changes') undoChanges();
    if (action === 'help') { $('#modal-help').hidden = false; }
    if (action === 'escape') {
      if (state.busy) { api.invoke('chat:cancel').catch(() => {}); setBusy(false); }
      if (!$('#modal-approval').hidden) answerApproval(false);
      $$('.modal').forEach((m) => { if (m.id !== 'modal-approval') m.hidden = true; });
    }
  }

  async function newSession() {
    try {
      const res = await api.invoke('session:new');
      state.sessionId = res.sessionId || res.id;
      messages().innerHTML = '';
      hideWelcome(false);
      state.attachments = [];
      renderAttachments();
      state.canUndo = false;
      $('#btn-undo').hidden = true;
      renderSessions();
      $('#input').focus();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function openSession(id) {
    try {
      const res = await api.invoke('session:load', { id });
      state.sessionId = res.state?.sessionId || id;
      applyState(res.state);
      renderTranscript(res.session?.transcript || [], res.session?.plans || [], res.state?.mode || 'plan');
      setMode(res.state?.mode || 'plan');
    } catch (err) { toast(err.message, 'err'); }
  }

  async function undoChanges() {
    try {
      await api.invoke('workspace:undo');
      state.canUndo = false;
      $('#btn-undo').hidden = true;
      toast(t('undo.done'), 'ok');
      loadTree();
    } catch (err) { toast(err.message, 'err'); }
  }

  /* ── boot ──────────────────────────────────────────────────── */
  async function boot() {
    captureEN();
    applyTheme();
    applyLang();
    setBusy(false);

    try {
      const data = await api.invoke('state');
      state.info = data;
      state.settings = data.settings || {};
      state.presets = data.presets || [];
      state.sessions = data.sessions || [];
      state.recents = data.recents || [];
      state.browser = Boolean(data.browser);
      onWorkspace(data.state?.workspace || { root: null }, state.recents);
      applyState(data.state);
      paintSettings();
      $('#app-meta').innerHTML = '';
      [
        'v' + (data.version || '0.2.0'),
        data.browser ? 'browser mode' : ('Electron ' + (window.rafiqDesktop?.versions?.electron || '')),
        'Node ' + (window.rafiqDesktop?.versions?.node?.split('.')[0] || ''),
        state.settings.provider || ''
      ].filter(Boolean).forEach((text) => $('#app-meta').appendChild(el('span', 'meta-chip', esc(text))));
      renderSessions();
      renderRecents();
      if (!state.workspace.root) loadTree();
    } catch (err) {
      toast(err.message || 'Could not load Rafiq', 'err');
    }

    api.onEvent(handleEvent);

    /* wiring */
    $('#btn-workspace').addEventListener('click', () => chooseWorkspace().catch((e) => toast(e.message, 'err')));
    $('#btn-new').addEventListener('click', newSession);
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-model').addEventListener('click', openSettings);
    $('#btn-help').addEventListener('click', () => { $('#modal-help').hidden = false; });
    $('#btn-theme').addEventListener('click', () => { saveUI({ theme: ui.theme === 'light' ? 'dark' : 'light' }); applyTheme(); });
    $('#btn-lang').addEventListener('click', () => { lang = lang === 'ar' ? 'en' : 'ar'; applyLang(); });
    $('#btn-sidebar').addEventListener('click', () => $('#app').classList.toggle('sidebar-open'));
    $('#btn-undo').addEventListener('click', undoChanges);
    $('#btn-explorer').addEventListener('click', () => {
      const panel = $('#explorer');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) loadTree();
    });
    $('#btn-close-explorer').addEventListener('click', () => { $('#explorer').hidden = true; });
    $('#btn-refresh').addEventListener('click', loadTree);
    $('#btn-close-file').addEventListener('click', () => { $('#file-view').hidden = true; });
    $('#btn-copy-file').addEventListener('click', () => {
      copyText($('#file-code').textContent || '');
    });
    $('#btn-add-file').addEventListener('click', attachOpenFile);
    $('#btn-attach').addEventListener('click', attachOpenFile);
    $('#btn-send').addEventListener('click', () => sendMessage());
    $('#btn-stop').addEventListener('click', () => {
      api.invoke('chat:cancel').catch(() => {});
      setBusy(false);
      toast(t('chat.stopped'));
    });
    $('#input').addEventListener('input', autoGrow);
    $('#input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });
    $('#input').addEventListener('paste', () => setTimeout(autoGrow, 0));
    $$('.quick').forEach((btn) => btn.addEventListener('click', () => {
      $('#input').value = btn.dataset.prompt || btn.textContent.trim();
      $('#input').focus();
      autoGrow();
    }));

    $$('.mode').forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    /* settings modal */
    $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => { $('#' + btn.dataset.close).hidden = true; }));
    $$('.modal').forEach((modal) => modal.addEventListener('click', (e) => {
      if (e.target === modal && modal.id !== 'modal-approval') modal.hidden = true;
    }));
    $('#set-provider').addEventListener('change', (e) => {
      const preset = state.presets.find((p) => p.id === e.target.value);
      if (preset) {
        if (preset.baseUrl) $('#set-baseurl').value = preset.baseUrl;
        if (preset.models.length && !$('#set-model').value) $('#set-model').value = preset.models[0];
      }
      paintModelOptions();
    });
    $('#set-temp').addEventListener('input', (e) => { $('#temp-out').textContent = Number(e.target.value).toFixed(1); });
    $('#set-apikey').addEventListener('input', () => { state.keyDirty = true; });
    $('#btn-toggle-key').addEventListener('click', () => {
      const input = $('#set-apikey');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      $('#btn-toggle-key').textContent = isPassword ? t('settings.hide') : t('settings.show');
    });
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#btn-fetch-models').addEventListener('click', fetchModels);

    /* approval */
    $('#btn-allow').addEventListener('click', () => answerApproval(true));
    $('#btn-deny').addEventListener('click', () => answerApproval(false));

    /* browser-mode workspace picker */
    $('#ws-open').addEventListener('click', async () => {
      const path = $('#ws-input').value.trim();
      if (!path) return;
      try {
        const res = await api.invoke('workspace:open', { path });
        $('#modal-workspace').hidden = true;
        onWorkspace(res.workspace, res.recents);
        toast(lang === 'ar' ? 'تم فتح المجلد' : 'Folder opened', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newSession(); }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); chooseWorkspace().catch(() => {}); }
      if (e.key === 'Escape' && state.busy) {
        api.invoke('chat:cancel').catch(() => {});
        setBusy(false);
      }
    });

    autoGrow();
    if (!state.settings.hasKey && !/127\.0\.0\.1|localhost/.test(state.settings.baseUrl || '')) {
      setTimeout(() => {
        toast(lang === 'ar' ? 'ضيف مفتاح API عشان تبدأ' : 'Add your API key in Settings to start', 'ok');
      }, 900);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

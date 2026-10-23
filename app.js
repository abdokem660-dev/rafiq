/* ═══════════════════════════════════════════════════════════════════
   RAFIQ — LANDING PAGE SCRIPT
   i18n (AR/EN), theme (light/dark), mobile menu, FAQ accordions,
   scroll reveals. Zero dependencies.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS = 'rafiq.lp';
  var ar = {
    'a11y.skip': 'تخطَّى إلى المحتوى',
    'nav.features': 'المميزات',
    'nav.how': 'طريقة الاستخدام',
    'nav.security': 'الخصوصية',
    'nav.download': 'تحميل',
    'nav.faq': 'الأسئلة',
    'nav.cta': 'تحميل',

    'hero.badge': 'خاص · محلي · مفتاحك معاك',
    'hero.title.line1': 'وكيل برمجة',
    'hero.title.line2': 'خاصّ بيك',
    'hero.sub': 'رَفِيق تطبيق سطح مكتب حقيقي لويندوز: افتح مجلد، اشرح الهدف، وهو يخطط وينفّذ — وكل حاجة على جهازك.',
    'hero.cta': 'حمّل رَفِيق',
    'hero.cta2': 'شوف طريقة الاستخدام',
    'hero.meta1': 'ويندوز 10 و 11',
    'hero.meta2': 'من غير كلاود',
    'hero.meta3': 'مش محتاج Node',
    'hero.term.prompt': 'ضيف زرار الوضع الداكن في صفحة الإعدادات',
    'hero.term.plan': 'يقرأ src/settings.js و src/theme.css وبعدين يضيف زرار محفوظ',

    'trust.k1': 'المفتاح مشفّر على جهازك',
    'trust.k2': 'محدود بمجلد واحد',
    'trust.k3': 'ولا حاجة تخرج من جهازك',

    'features.kicker': 'ليه رَفِيق',
    'features.title': 'وكيل واحد، تحت سيطرتك الكاملة',
    'features.sub': 'تطبيق ويندوز حقيقي، من غير كلاود، ومن غير مكتبات — وكود تقدر تقراه.',
    'features.byok.title': 'مفتاحك بيك (BYOK)',
    'features.byok.body': 'مفتاح API بيتشفّر بحساب ويندوز بتاعك (DPAPI) وبيتستخدم بس عشان يكلم المزوّد اللي اخترته. مفيش حساب مع رَفِيق، ولا بروكسي كلاود، والمفتاح عمره ما يخرج من جهازك.',
    'features.modes.title': 'خطّط ← نفّذ ← ناقش',
    'features.modes.body': 'استعرض الخطة قبل ما توافق، خلّي الوكيل يبني في مشروعك، أو ببساطة ناقش الكود. الشغل بيطلع حي خطوة بخطوة.',
    'features.fs.title': 'ملفاتك الفعلية، في صندوق آمن',
    'features.fs.body': 'وصّل رَفِيق لأي مجلد مشروع حقيقي. هو بيعدّل جوه الـ workspace اللي اخترته بس — بيتأكد إنك ماسك مسار سليم — وميلمسش باقي الهارد.',
    'features.prov.title': 'كل عائلات الموديلات اللي تحبها',
    'features.prov.body': 'رَفِيق بيكلم أي endpoint متوافق مع OpenAI، أو موديل محلي على Ollama — فأنت اللي بتختار العقل.',
    'features.safety.title': 'السلامة افتراضية',
    'features.safety.body': 'العمليات الخطيرة مقفولة، وكل أمر محتاج موافقتك، وأي تغيير في جولة تقدر تتراجع عنه بزرار واحد.',
    'features.sessions.title': 'تاريخك، على جهازك',
    'features.sessions.body': 'كل جلسة وكل خطة وكل محادثة محفوظة محليًا في مجلد بيانات رَفِيق. مفيش سيرفرات لوجات ولا تحليلات.',
    'features.i18n.title': 'عربي و English',
    'features.i18n.body': 'واجهة كاملة بالعربي والإنجليزي، مع ثيم فاتح دافي وثيم داكن مريح للعين — بتسترخي في جو مطورين القاهرة.',
    'features.files.title': 'ملفات مدمجة',
    'features.files.body': 'متصفّح ملفات وعارض كود مع معاينة مريحة للعين وزر نسخ بكبسة واحدة — جوه التطبيق نفسه.',

    'how.kicker': 'ابدأ من هنا',
    'how.title': 'تشغّل في تلات خطوات',
    'how.sub': 'مفيش حسابات ولا تسجيل ولا كلاود. ثبّته، افتح مجلد، اشرح الهدف.',
    'how.s1.title': 'ثبّت وابدأ',
    'how.s1.body': 'شغّل المثبّت (أو فك ضغط النسخة المتنقلة) وافتح رَفِيق. نافذة أصلية على سطح المكتب — من غير تيرمنال ولا localhost ولا Node.js.',
    'how.s2.title': 'حُط مفتاحك',
    'how.s2.body': 'افتح الإعدادات، اختار المزوّد، والصق مفتاح API. بيتشفّر بحساب ويندوز وبيتحفظ على الجهاز ده بس.',
    'how.s3.title': 'اشرح الهدف',
    'how.s3.body': 'قول لرَفِيق هتعمل إيه. راجع الخطة، وافق، واتفرج عليه وهو بيبني — أو اسأل على الكود بتاعك.',

    'security.kicker': 'الخصوصية',
    'security.title': 'بياناتك بتروح فين؟',
    'security.sub': 'تلات جهات، اتنين منهم جهازك أنت.',
    'security.s1.title': 'مفتاح API ← الجهاز ده بس',
    'security.s1.body': 'بيتشفر بـ DPAPI وبيتحفظ في %APPDATA%\\Rafiq. بيتستخدم بس في الطلب اللي رايح للمزوّد اللي اخترته.',
    'security.s2.title': 'التطبيق ← مجلدك بس',
    'security.s2.body': 'كل عملية ملفات بتتفحص إنها جوه المجلد اللي فتحته. الأوامر محتاجة موافقتك والخطير منها مقفول. مفيش تتبع ولا حساب.',
    'security.s3.title': 'الطلب ← مزوّد الموديل',
    'security.s3.body': 'المكالمة الوحيدة اللي بتطلع هي لمزوّد اللي اخترته، حاملة نفس السياق اللي بعتّه. ولا حاجة تانية تخرج من الجهاز.',

    'download.kicker': 'حمّله',
    'download.title': 'حمّل رَفِيق لويندوز',
    'download.sub': 'نسختين من نفس التطبيق: مثبّت، أو نسخة متنقلة تشغّلها من أي مكان.',
    'down.setup.use': 'مثبّت ويندوز. بيضيف رَفِيق لقائمة ابدأ وسطح المكتب، من غير صلاحيات مدير ومن غير Node.js.',
    'down.setup.badge': 'موصى به',
    'down.portable.use': 'من غير تثبيت: فك الضغط في أي مكان وشغّل Rafiq.exe — حتى من فلاشة.',
    'down.portable.badge': 'متنقل',
    'down.platform': 'النظام',
    'down.win.versions': 'ويندوز 10 و 11 (64 بت)',
    'down.requires': 'متطلبات',
    'down.setup.requires': 'ولا حاجة — كله مدمج',
    'down.portable.requires': 'فك ضغط بس',
    'down.size': 'الحجم',
    'down.download': 'تحميل',
    'down.sums': 'تحقّق من التحميل',
    'download.note': 'النسخة لسه مش موقّعة إلكترونيًا، فممكن ويندوز يعرض تحذير "ناشر غير معروف" — اختار More info ثم Run anyway. ولو عايز تبنيها بنفسك، الكود كله في مجلد desktop و npm run dist:win بيطلع نفس المثبّت.',

    'faq.kicker': 'أسئلة شائعة',
    'faq.title': 'أسئلة بتتكرر',
    'faq.q1': 'إيه؟ محتاج Node.js؟',
    'faq.a1': 'لا. تطبيق سطح المكتب فيه كل حاجة: نزّل المثبّت أو النسخة المتنقلة وشغّله وخلاص. Node.js محتاجه بس لو عايز تبني رَفِيق من السورس.',
    'faq.q2': 'مفتاح API بيتخزن فين؟',
    'faq.a2': 'على الجهاز ده، مشفّر بحساب ويندوز (DPAPI) في %APPDATA%\\Rafiq. عمره ما بيتبعت لرَفِيق — بس للمزوّد اللي ظبّطته.',
    'faq.q3': 'هل يقدر يلمس ملفات برّة الـ workspace؟',
    'faq.a3': 'لا. كل مسار بيتفحص مقابل جذر المشروع، وملفات .rafiq-ignore بتتحترم، وأوامر shell الخطيرة مقفولة إلا لو فتحتها، وأي جولة ينفع تتراجع عنها.',
    'faq.q4': 'هل يشتغل أوفلاين؟',
    'faq.a4': 'التطبيق وحلقة الوكيل وملفاتك كلها محلية. الوحيد اللي محتاج إنترنت هو نداء مزوّد الموديل — إلا لو ربطته بموديل محلي على Ollama أو LM Studio.',
    'faq.q5': 'أعمل إيه عشان أحدّث؟',
    'faq.a5': 'ثبّت الإصدار الجديد فوق القديم (أو فك ضغط النسخة المتنقلة الجديدة). جلساتك وإعداداتك في %APPDATA%\\Rafiq وهتفضل زي ما هي.',

    'cta.title': 'جاهزين؟',
    'cta.sub': 'مجاني، محلي، ومالك للأبد. ثبّته على ويندوز، افتح مجلد، واعمل أول تغيير في دقايق.',
    'cta.cta': 'حمّل رَفِيق',
    'footer.slogan': 'وكيل برمجة خاص لويندوز. متبني عشان تقراه.'
  };

  var en = {};
  var lang = 'en';
  var theme = 'light';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function camelize(key) {
    return key.replace(/\-+(.)?/g, function (_, c) { return c ? c.toUpperCase() : ''; });
  }

  function captureEn() {
    $$('[data-i18n]').forEach(function (el) {
      var key = camelize(el.getAttribute('data-i18n'));
      if (!(key in en)) en[key] = el.textContent;
    });
  }

  function applyLang() {
    var table = lang === 'ar' ? ar : en;
    $$('[data-i18n]').forEach(function (el) {
      var key = camelize(el.getAttribute('data-i18n'));
      if (key in table) el.textContent = table[key];
    });
    var html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    var target = lang === 'ar' ? 'EN' : 'عربي';
    $('#lang-label').textContent = target;
    var btn = $('#btn-lang');
    btn.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    btn.title = target;
    document.title = lang === 'ar' ? 'رَفِيق — وكيل برمجة خاصّ بيك' : 'Rafiq — your private coding agent for Windows';
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', lang === 'ar'
      ? 'رَفِيق وكيل برمجة خاص ومحلي لويندوز في تطبيق سطح مكتب. مفتاحك معاك، اشتغل على ملفاتك الفعلية، وخطّط ثم نفّذ ثم ناقش على جهازك.'
      : 'Rafiq is a private, local-first coding agent for Windows. A real desktop app: open a folder, plan → build → discuss, with your own API key and your data on your machine.');
  }

  function applyTheme() {
    var html = document.documentElement;
    html.setAttribute('data-theme', theme);
    var btn = $('#btn-theme');
    var dark = theme === 'dark';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Light' : 'Dark';
    $('#ic-sun').style.display = dark ? 'block' : 'none';
    $('#ic-moon').style.display = dark ? 'none' : 'block';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#121317' : '#F4F5F7');
  }

  function save() {
    try { localStorage.setItem(LS, JSON.stringify({ lang: lang, theme: theme })); } catch (e) {}
  }

  function init() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
    if (p && p.lang === 'ar') lang = 'ar';
    if (p && p.theme === 'dark') theme = 'dark';

    captureEn();
    applyTheme();
    applyLang();

    $('#btn-theme').addEventListener('click', function () {
      theme = theme === 'light' ? 'dark' : 'light';
      applyTheme();
      save();
    });
    $('#btn-lang').addEventListener('click', function () {
      lang = lang === 'en' ? 'ar' : 'en';
      applyLang();
      save();
    });

    var mMenu = $('#mobile-menu');
    var mBtn = $('#btn-menu');
    mBtn.addEventListener('click', function () {
      var open = mMenu.classList.toggle('open');
      mBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $$('#mobile-menu a').forEach(function (a) {
      a.addEventListener('click', function () {
        mMenu.classList.remove('open');
        mBtn.setAttribute('aria-expanded', 'false');
      });
    });

    $$('.faq-q').forEach(function (q) {
      q.addEventListener('click', function () {
        var item = q.parentElement;
        var open = item.classList.toggle('open');
        q.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    $$('.bento, .steps, .sec-grid, .faq, .dl-grid').forEach(function (list) {
      $$('.reveal', list).forEach(function (el, i) { el.style.setProperty('--i', i); });
    });

    if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12 });
      $$('.reveal').forEach(function (el) { io.observe(el); });
    } else {
      $$('.reveal').forEach(function (el) { el.classList.add('in'); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

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
    'hero.sub': 'رَفِيق بيحوّل مساحة شغلك لرفيق برمجة بشغّل على جهازك أنت بس. اشرحله الهدف — رَفِيق يخطط ثم ينفّذ — وبياناتك تفضل ملكك.',
    'hero.cta': 'حمّل رَفِيق',
    'hero.cta2': 'شوف طريقة الاستخدام',
    'hero.meta1': 'ويندوز 7 – 11',
    'hero.meta2': 'صفر مكتبات خارجية',
    'hero.term.ready': '→ شغال على http://localhost:3000',

    'trust.k1': 'المفتاح محفوظ في المتصفح',
    'trust.k2': 'محلي فقط',
    'trust.k3': 'ولا حاجة تخرج من جهازك',

    'features.kicker': 'ليه رَفِيق',
    'features.title': 'وكيل واحد، تحت سيطرتك الكاملة',
    'features.sub': 'اتبنى لهوما الاتنين وجهاز واحد — من غير كلاود، من غير مكتبات، وكود تقدر تقراه.',
    'features.byok.title': 'مفتاحك بيك (BYOK)',
    'features.byok.body': 'مفتاح API بتاعك عايش في المتصفح وبيتبعت لمزوّد الموديل مع كل طلب عبر بروكسي محلي. السيرفر عمره ما يخزّنه، ومفيش حساب تفتحه مع رَفِيق أصلاً.',
    'features.modes.title': 'خطّط ← نفّذ ← ناقش',
    'features.modes.body': 'استعرض الخطة قبل ما توافق، خلّي الوكيل يبني في مشروعك، أو ببساطة ناقش الكود. الشغل بيطلع حي خطوة بخطوة.',
    'features.fs.title': 'ملفاتك الفعلية، في صندوق آمن',
    'features.fs.body': 'وصّل رَفِيق لأي ملفات مشروع حقيقي. هو بيعدّل جوه الـ workspace اللي اخترته بس — بيتأكد إنك ماسك مسار سليم — وميلمسش باقي الهارد.',
    'features.prov.title': 'كل عائلات الموديلات اللي تحبها',
    'features.prov.body': 'رَفِيق بيكلم أي endpoint متوافق مع OpenAI، فأنت اللي بتختار العقل — والعكس.',
    'features.safety.title': 'السلامة افتراضية',
    'features.safety.body': 'العمليات الخطيرة مقفولة. فكّها لكل workspace لو عايز، وأي تغيير بياخد git snapshot تقدر ترجعله في أي وقت.',
    'features.sessions.title': 'تاريخك، على جهازك',
    'features.sessions.body': 'كل جلسة وكل خطة وكل محادثة محفوظة محليًا على جهازك. مفيش سيرفرات لوجات ولا تحليلات ولا حاجة.',
    'features.i18n.title': 'عربي و English',
    'features.i18n.body': 'واجهة كاملة بالعربي والإنجليزي، مع ثيم فاتح دافي وثيم داكن مريح للعين — بتسترخي في جو مطورين القاهرة.',
    'features.files.title': 'ملفات مدمجة',
    'features.files.body': 'متصفّح ملفات وعارض كود مع معاينة مريحة للعين وزرار نسخ بكبسة واحدة — المتصفح بيبقى IDE مصغّر.',

    'how.kicker': 'ابدأ من هنا',
    'how.title': 'تشغّل في تلات خطوات',
    'how.sub': 'مفيش تثبيت ولا حسابات ولا تسجيل. مجرد مجلد ومتصفح.',
    'how.s1.title': 'فك الضغط وابدأ',
    'how.s1.body': 'فك الباكدج في أي مكان وبدبل كلك على start.bat. رَفِيق يشغّل السيرفر المحلي ويفتح المتصفح — من غير أي تثبيت.',
    'how.s2.title': 'حُط مفتاحك',
    'how.s2.body': 'افتح الإعدادات، اختار المزوّد، والصق مفتاح API. بيتحفظ في متصفحك أنت بس، عمره ما يوصل السيرفر.',
    'how.s3.title': 'اشرح الهدف',
    'how.s3.body': 'قول لرَفِيق هتعمل إيه. راجع الخطة، وافق، واتفرج عليه وهو بيبني — أو اسأل على الكود بتاعك.',

    'security.kicker': 'الخصوصية',
    'security.title': 'بياناتك بتروح فين؟',
    'security.sub': 'تلات جهات، اتنين منهم جهازك أنت.',
    'security.s1.title': 'مفتاح API ← المتصفح بس',
    'security.s1.body': 'محفوظ في localStorage على جهازك. بيتبعت للسيرفر المحلي ثم للمزوّد، والسيرفر عمره ما يخزّنه.',
    'security.s2.title': 'التطبيق ← المحلي بس',
    'security.s2.body': 'رَفِيق مربوط بــ 127.0.0.1 وبيرسل headers أمنية صارمة. مفيش سيرفر كلاود ولا تتبع ولا حساب.',
    'security.s3.title': 'الطلب ← مزوّد الموديل',
    'security.s3.body': 'المكالمة الوحيدة اللي بتطلع هي لمزوّد اللي اخترته، حاملة نفس السياق اللي بعتّه. ولا حاجة تانية تخرج من الجهاز.',

    'download.kicker': 'حمّله',
    'download.title': 'حمّل رَفِيق لويندوز',
    'download.sub': 'باكدجين، نفس المنتج. اختار اللي يناسب جهازك. SHA-256 موجودة للتحقق.',
    'down.win7.use': 'لكل حاجة — بمن فيهم ويندوز 7، ومش محتاج Node. نسخة Node متنقلة مدمجة.',
    'down.win7.badge': 'موصى به',
    'down.win.use': 'للأجهزة اللي Node 18+ نزلها أصلًا — صغير وسريع.',
    'down.win.badge': '89 ك.ب',
    'down.platform': 'النظام',
    'down.requires': 'متطلبات',
    'down.win7.requires': 'ولا حاجة — Node المتنقلة مدمجة',
    'down.win.requires': 'Node.js 18 أو أحدث',
    'down.size': 'الحجم',
    'down.download': 'تحميل',
    'download.note': 'الباكدجين فيهم سكريبتات من غير أي اعتماديات: install.bat و start.bat و stop.bat. ملف README.md جوا بيشرح كل خطوة. ولا حاجة بتتنفذ غير لما تشغّله أنت.',

    'faq.kicker': 'أسئلة شائعة',
    'faq.title': 'أسئلة بتتكرر',
    'faq.q1': 'إيه؟ محتاج Node.js؟',
    'faq.a1': 'لا. خد الباكدج المتنقل (rafiq-win7.zip) وNode هتشتغل من جوه الزيب مباشرة. ولو عندك Node 18+ خلاص، الباكدج الصغير 89 ك.ب يكفيك.',
    'faq.q2': 'مفتاح API بيتخزن فين؟',
    'faq.a2': 'فيه متصفحك أنت بس. رَفِيق بيبعت طلبك للمزوّد عبر بروكسي محلي وعمره ما بيكتب المفتاح على الديسك ولا في أي سيرفر.',
    'faq.q3': 'هل يقدر يلمس ملفات برّة الـ workspace؟',
    'faq.a3': 'لا. السيرفر بيفرض فحص مسار، وبيراعي ملفات .rafiq-ignore، وبيمنع أوامر shell الخطيرة إلا لو فتحتها صراحةً للـ workspace ده.',
    'faq.q4': 'هل يشتغل أوفلاين؟',
    'faq.a4': 'التطبيق كله والسيرفر وحلقة الوكيل شغالين محليًا. الوحيد اللي محتاج إنترنت هو نداء مزوّد الموديل — لأن العقل هناك.',
    'faq.q5': 'أعمل إيه عشان أحدّث؟',
    'faq.a5': 'أوقف السيرفر، واستبدل الملفات بالباكدج الجديد، وابدأ تاني. جلساتك وإعداداتك على الجهاز ده وهتفضل زي ما هي.',

    'cta.title': 'جاهزين؟',
    'cta.sub': 'مجاني، محلي، ومالك للأبد. بداية الغطسة في كوده الخاص بيك بتبدأ بتحميلة واحدة.',
    'cta.cta': 'حمّل رَفِيق',
    'footer.slogan': 'وكيل برمجة خاص لهوما الاتنين.'
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
    document.title = lang === 'ar' ? 'رَفِيق — وكيل برمجة خاصّ بيك' : 'Rafiq — your private coding agent';
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', lang === 'ar'
      ? 'رَفِيق وكيل برمجة خاص ومحلي لويندوز. مفتاحك معاك، اشتغل على ملفاتك الفعلية، وخطّط ثم نفّذ ثم ناقش مشروعك كله على جهازك.'
      : 'Rafiq is a private, local-first coding agent for Windows. Bring your own API key, work in your real filesystem, and plan → build → discuss with your project completely on your machine.');
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

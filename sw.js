/* MODO AI service worker
 * الهدف: تثبيت كتطبيق + فتح سريع + شغل بدون نت للصفحة نفسها.
 * قاعدة أساسية: أي طلب مش من الأنواع المسموحة تحت بيعدّي زي ما هو (من غير respondWith)،
 * يعني المساعد الذكي (Gemini) وSupabase وApps Script بيشتغلوا بالظبط كأن مفيش service worker. */
const VERSION = 'modo-v1';
const SHELL = 'modo-shell-' + VERSION;   // الصفحة نفسها
const ASSETS = 'modo-assets-' + VERSION; // خطوط ومكتبات ثابتة
const PAGE_TIMEOUT_MS = 3000;            // لو النت بطيء أكتر من كده افتح النسخة المحفوظة

// الدومينات الثابتة اللي مسموح نخزّنها (خطوط ومكتبات 3D/تصميم). غير كده: مش بنلمسه.
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.tailwindcss.com'];

self.addEventListener('install', e => {
  // بنخزّن الصفحة الرئيسية بس (من غير ما نوقف التثبيت لو فشلت)
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['./', 'manifest.json', 'icon-192.png', 'icon-512.png'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL, ASSETS];
    for (const k of await caches.keys()) if (k.startsWith('modo-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                    // POST (Supabase/Gemini/Apps Script) يعدّي طبيعي
  const url = new URL(req.url);

  // 1) الصفحة نفسها: الشبكة الأول (عشان التحديثات توصل فورًا)، ولو بطيئة أو مفيش نت → النسخة المحفوظة
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        const fresh = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), PAGE_TIMEOUT_MS))
        ]);
        if (fresh && fresh.ok) cache.put('./', fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await cache.match('./');
        if (hit) return hit;
        return fetch(req);                              // مفيش نسخة محفوظة: حاول عادي
      }
    })());
    return;
  }

  // 2) ملفات الموقع الثابتة (أيقونات/manifest): الكاش الأول
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }

  // 3) الخطوط والمكتبات الثابتة: ارجع المحفوظ فورًا وحدّثه في الخلفية
  if (STATIC_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }
  // 4) أي حاجة تانية (Gemini, Supabase, Apps Script, واتساب...): مفيش respondWith → بتعدّي من غير تدخل
});

/* ============================================================================
   CINNAMOOD — OFFLINE
   ----------------------------------------------------------------------------
   Once an iPad has opened the machine, it keeps a complete copy and runs from
   it. After that first load the machine does not need the host to be up, the
   hosting bill to be paid, or the venue's wifi to be working in order to
   START — which are three separate ways an event could otherwise be ruined
   between setting up and the doors opening.

   It also means each iPad fetches the machine roughly once instead of on every
   reload, which is the difference between a handful of requests over an event
   and several per guest.

   WHAT IS NOT CACHED
   ------------------
   Guests. This only ever caches the machine itself — the page, the code, the
   fonts, the artwork. Anything posted to Google goes straight out to the
   network, and if the network is down the lead waits in the iPad's own queue
   rather than in here. A cached POST would be a lie about a guest being saved.

   IF A BAD VERSION EVER GETS STUCK
   --------------------------------
   Bump CACHE. Everything from the old one is deleted on activate. Staff also
   have "Update the machine" in the panel, which throws this away and reloads.
   ============================================================================ */

const CACHE = 'cinnamood-v3';

/* Listed rather than discovered, so a typo fails loudly at install time
   instead of quietly leaving one file uncached until the day it is needed. */
const SHELL = [
  './',
  './index.html',
  './shared/base.css',
  './shared/config.js',
  './shared/symbols.js',
  './shared/audio.js',
  './shared/engine.js',
  './shared/celebrate.js',
  './shared/cabinet.js',
  './shared/leads.js',
  './shared/gate.js',
  './shared/admin.js',
  './shared/skin.js',
  './shared/fonts/LynoStan.otf',
  './shared/fonts/LynoJean.otf',
  './shared/img/logo-white.png',
  './shared/img/logo-berry.png',
  './shared/img/icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      /* `cache: 'reload'` goes past the browser's own HTTP cache.

         Without it, installing a new version refetches through that cache and
         can faithfully store the OLD files — which is exactly what happened
         once: the cache was bumped, everything refetched, and the machine came
         back running the previous build. A new version that quietly installs
         the old one is worse than no update mechanism at all, because it looks
         like it worked. */
      .then(c => Promise.all(SHELL.map(u =>
        fetch(new Request(u, { cache: 'reload' }))
          .then(res => { if (res && res.ok) return c.put(u, res); })
      )))
      // Take over straight away rather than waiting for every tab to close —
      // on a kiosk there is only ever one tab and it is never closed.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  // The panel's "Update the machine" button.
  if (e.data === 'cinnamood-update') {
    caches.delete(CACHE).then(() => self.skipWaiting());
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;

  /* Guests never come from a cache. Only GETs are cacheable at all, and
     anything leaving this origin — the Google Sheet — must always really go. */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        /* Serve the copy we have, and quietly refresh it for next time. The
           machine must start instantly and identically whether or not there is
           a network; a cache-then-update keeps that true while still letting a
           new deploy land on the following load. */
        fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        /* Offline and never seen: the only sensible answer for a navigation is
           the page we do have. */
        req.mode === 'navigate' ? caches.match('./index.html') : Response.error()
      );
    })
  );
});

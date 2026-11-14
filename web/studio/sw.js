// The blog's one service worker (ADR 0412, Studio R3 G24), served at /admin/sw.js with scope /admin/
// so every install and sign-up made before Studio keeps working. It shows a notification the push
// function sent, and opens the Studio screen it is about when tapped. Since R4 (G35) it also keeps
// Studio's own files, so New job opens on a roof with no signal:
//
// - Only Studio's static files: the list the server put on the first line (`self.STUDIO_RELEASE`,
//   every file under /admin/studio/), never an /admin/api/ reply, never anything of the session,
//   never the old Admin's pages.
// - Network first: with a signal every file comes from the server as before (and the copy is
//   refreshed); only when the server can't be reached is the kept copy used.
// - Versioned: a new release is a new worker with a new cache, and the old one is deleted.
//
// A classic script (no imports). studioAddress() and keeps() are copied in
// parts/notification-rules.js and parts/worker-rules.js, where they are tested; a test keeps the
// copies the same.
const RELEASE = self.STUDIO_RELEASE || { version: "dev", files: [] };
const CACHE = `studio-${RELEASE.version}`;

/** Whether a request is one of Studio's own files the worker keeps: a GET under /admin/studio/ on this origin. */
function keeps(url, method, origin) {
  if (method !== "GET") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === origin && parsed.pathname.startsWith("/admin/studio/") && !parsed.pathname.includes("/api/") && !parsed.search;
}

self.addEventListener("install", (event) => {
  // Everything but Studio's own files (the API, the old Admin, the icons) goes straight to the
  // network without waking the worker, where the browser can say so (Chrome's static routes).
  if (typeof event.addRoutes === "function" && typeof URLPattern === "function") {
    const studio = new URLPattern({ pathname: "/admin/studio/*" });
    event.waitUntil(Promise.resolve()
      .then(() => event.addRoutes([{ condition: { not: { urlPattern: studio } }, source: "network" }]))
      .catch(() => event.addRoutes([{ condition: { urlPattern: new URLPattern({ pathname: "/admin/api/*" }) }, source: "network" }]))
      .catch(() => {}));
  }
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A few at a time, so a first visit isn't slowed; one file that doesn't come is fetched again
    // when it's next asked for, and the rest are kept.
    const files = [...RELEASE.files];
    const next = async () => {
      for (let file = files.shift(); file; file = files.shift()) {
        try {
          const response = await fetch(new Request(file, { cache: "no-cache", credentials: "same-origin" }));
          if (response.ok && response.type === "basic") await cache.put(file, response);
        } catch {
          // Kept the next time it's asked for.
        }
      }
    };
    await Promise.all([next(), next(), next(), next()]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("studio-") && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!keeps(request.url, request.method, self.location.origin)) return;
  const key = new URL(request.url).pathname === "/admin/studio/index.html" ? "/admin/studio/" : new URL(request.url).pathname;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {}));
      }
      return response;
    } catch (error) {
      const kept = await caches.match(key, { cacheName: CACHE });
      if (kept) return kept;
      throw error;
    }
  })());
});

/**
 * Where tapping a notice goes: the old Admin's addresses (`/admin/`, `/admin/#/quotes`) become
 * Studio's with the same `#…`; a Studio address is kept; an https page from the owner's other app is
 * kept; anything else (another path, http:, javascript:, data:) opens Studio's Home.
 */
function studioAddress(url, origin) {
  const home = `${origin}/admin/studio/`;
  let parsed;
  try {
    parsed = new URL(String(url || ""), home);
  } catch {
    return home;
  }
  if (parsed.origin === origin) {
    if (parsed.pathname === "/admin/" || parsed.pathname === "/admin") return `${home}${parsed.hash}`;
    if (parsed.pathname.startsWith("/admin/studio/")) return parsed.href;
    return home;
  }
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return parsed.href;
  return home;
}

self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = {};
  }
  if (!notice || typeof notice !== "object") notice = {};
  const title = String(notice.title || "Something new on your blog").slice(0, 80);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(notice.body || "").slice(0, 180),
    tag: notice.tag ? String(notice.tag).slice(0, 64) : undefined,
    icon: "/admin/icons/icon-192.png",
    badge: "/admin/icons/badge-96.png",
    data: { url: studioAddress(notice.url, self.location.origin) },
  }));
});

// A Studio window already open is focused and asked to go there itself, so its leave-guard asks
// before unsaved work is left (navigating it would reload the page without asking). Otherwise a new
// window opens, which on a phone is the installed app when there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const origin = self.location.origin;
  // Notices shown by the old worker still carry old addresses: they go through the same rules.
  const url = studioAddress(event.notification.data?.url, origin);
  event.waitUntil((async () => {
    const target = new URL(url);
    if (target.origin === origin && target.pathname === "/admin/studio/") {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const studio = windows.find((client) => {
        try {
          const at = new URL(client.url);
          return at.origin === origin && at.pathname === "/admin/studio/";
        } catch {
          return false;
        }
      });
      if (studio) {
        try {
          await studio.focus();
        } catch {
          // Focusing can be refused; the message still moves the page.
        }
        studio.postMessage({ type: "open", hash: target.hash || "#/" });
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});

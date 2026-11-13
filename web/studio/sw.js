// The blog's one service worker (ADR 0412, Studio R3 G24), served at /admin/sw.js with scope /admin/
// so every install and sign-up made before Studio keeps working. It does two things: shows a
// notification the push function sent, and opens the Studio screen it is about when tapped. It
// caches nothing and answers no request, so every page always loads from the server.
//
// A classic script (no imports). studioAddress() is copied in parts/notification-rules.js, where it
// is tested; a test keeps the two copies the same.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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

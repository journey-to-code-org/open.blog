// Admin's service worker (ADR 0412). It does two things: shows a notification the push function
// sent, and opens the Admin page it is about when it is tapped. It caches nothing and answers no
// request, so Admin always loads from its server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A notice's link: a page in this Admin, or another https page the owner's own app sent.
function target(url) {
  try {
    const parsed = new URL(String(url || "./"), self.registration.scope);
    if (parsed.origin === self.location.origin || parsed.protocol === "https:") return parsed.href;
  } catch {
    // falls through
  }
  return self.registration.scope;
}

self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = {};
  }
  const title = String(notice.title || "Admin").slice(0, 80);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(notice.body || "").slice(0, 180),
    tag: notice.tag ? String(notice.tag).slice(0, 64) : undefined,
    icon: "/admin/icons/icon-192.png",
    badge: "/admin/icons/icon-192.png",
    data: { url: target(notice.url) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const admin = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (admin && new URL(url).origin === self.location.origin) {
      await admin.focus();
      return admin.navigate(url);
    }
    return self.clients.openWindow(url);
  })());
});

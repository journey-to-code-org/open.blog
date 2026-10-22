// <ob-views path="/posts/slug/"> counts a page view with the blog's own
// server and shows the total. It stays empty when the site is hosted
// statically (no counter to talk to), when the reader asked not to be
// tracked (Do Not Track or Global Privacy Control), or for automated browsers.
//
// What is sent: the page path and the referring site. No cookies, no
// identifiers; the server keeps a per-day salted hash in memory only to
// count unique visitors. One view per page per browser session.

class ObViews extends HTMLElement {
  async connectedCallback() {
    const path = this.getAttribute("path");
    if (!path) return;
    // The server also honours the DNT and Sec-GPC headers; this just avoids the request.
    const optedOut = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true || navigator.webdriver;
    const key = `ob-viewed:${path}`;
    let seen = false;
    try {
      seen = sessionStorage.getItem(key) === "1";
    } catch {
      // Storage blocked: we may count twice on reload, which is acceptable.
    }

    let views = null;
    try {
      if (optedOut || seen) {
        const res = await fetch(`/api/views?path=${encodeURIComponent(path)}`, { credentials: "omit" });
        if (res.ok) views = (await res.json()).views;
      } else {
        const res = await fetch("/api/hit", {
          method: "POST",
          credentials: "omit",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, referrer: document.referrer || "" }),
        });
        if (res.ok) {
          views = (await res.json()).views;
          try {
            sessionStorage.setItem(key, "1");
          } catch {
            // Fine.
          }
        }
      }
    } catch {
      // No server (static host) or offline: show nothing.
      return;
    }
    if (typeof views === "number" && views > 0) {
      this.textContent = ` · ${views.toLocaleString()} ${views === 1 ? "view" : "views"}`;
    }
  }
}

if (!customElements.get("ob-views")) {
  customElements.define("ob-views", ObViews);
}

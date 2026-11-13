// Hash routes → screens. `#/`, `#/posts`, `#/write`, `#/write/<path>`, `#/sign-in`.
// Before leaving a screen the router asks it (`leave()`), so unsaved work is never lost on the way.

/**
 * "#/write/posts/x.md" → { name: "write", arg: "posts/x.md", query: {} };
 * "#/posts?status=draft&q=pie" → { name: "posts", arg: "", query: { status: "draft", q: "pie" } }.
 * DOM-free, tested.
 */
export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path, search = ""] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));
  const [name, ...rest] = path.split("/");
  let arg = rest.join("/");
  try {
    arg = decodeURIComponent(arg);
  } catch {
    // A mangled address: keep it as typed rather than failing to start.
  }
  return { name: name || "home", arg, query };
}

/** The address for a route; empty query values are left out. */
export function routeHash(name, arg = "", query = {}) {
  const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== "" && value != null)).toString();
  const base = name === "home" ? "#/" : arg ? `#/${name}/${encodeURIComponent(arg)}` : `#/${name}`;
  return search ? `${base}?${search}` : base;
}

export function createRouter({ screens, onShow }) {
  let current = null;
  let currentHash = location.hash || "#/";
  let busy = false;

  // The address counts as current the moment a screen starts opening, so a quick second change
  // (Back, a link) isn't mistaken for "no change"; only the newest screen to finish is shown.
  let showing = 0;
  async function show(hash) {
    const turn = ++showing;
    currentHash = hash;
    const route = parseRoute(hash);
    const make = screens[route.name] || screens.home;
    const screen = await make(route);
    if (turn !== showing) return;
    current = screen;
    await onShow(screen, route);
  }

  async function onHashChange() {
    if (busy) return;
    const next = location.hash || "#/";
    if (next === currentHash) return;
    if (current?.leave) {
      busy = true;
      const go = await current.leave();
      busy = false;
      if (!go) {
        history.replaceState(null, "", currentHash);
        return;
      }
      current = null; // it has been left: never ask it again while the next screen opens
    }
    await show(next);
  }

  addEventListener("hashchange", onHashChange);
  addEventListener("beforeunload", (event) => {
    if (current?.isDirty?.()) event.preventDefault();
  });

  return {
    start: () => show(location.hash || "#/"),
    go(hash) {
      if (location.hash === hash) show(hash);
      else location.hash = hash;
    },
    /** The screen moved itself to a new address (a new post got its file): no new screen. */
    replace(hash) {
      history.replaceState(null, "", hash);
      currentHash = hash;
    },
    current: () => current,
  };
}

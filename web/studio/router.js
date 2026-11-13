// Hash routes → screens. `#/`, `#/posts`, `#/write`, `#/write/<path>`, `#/sign-in`.
// Before leaving a screen the router asks it (`leave()`), so unsaved work is never lost on the way.

/** "#/write/posts/x.md" → { name: "write", arg: "posts/x.md" } (DOM-free, tested). */
export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path] = raw.split("?");
  const [name, ...rest] = path.split("/");
  let arg = rest.join("/");
  try {
    arg = decodeURIComponent(arg);
  } catch {
    // A mangled address: keep it as typed rather than failing to start.
  }
  return { name: name || "home", arg };
}

export function routeHash(name, arg = "") {
  if (name === "home") return "#/";
  return arg ? `#/${name}/${encodeURIComponent(arg)}` : `#/${name}`;
}

export function createRouter({ screens, onShow }) {
  let current = null;
  let currentHash = location.hash || "#/";
  let busy = false;

  async function show(hash) {
    const route = parseRoute(hash);
    const make = screens[route.name] || screens.home;
    const screen = await make(route);
    current = screen;
    currentHash = hash;
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
    current: () => current,
  };
}

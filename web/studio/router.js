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

// The old Admin's addresses (bookmarks, links in notifications and invitations), and the Studio
// screen each now opens. A route Studio doesn't have yet opens "not-yet" with the old name, never a
// blank Home. Retirement plan R0; each later slice moves its names out of NOT_YET.
const OLD_RENAMED = {
  overview: "", series: "collections", landing: "front-page", appearance: "look", seasons: "decorations",
  moderation: "comments", feedback: "comments", analytics: "visitors", social: "sharing",
  announcements: "sharing", greetings: "cards",
};
const OLD_FOLDERS = { posts: "write", pages: "page", series: "collection", services: "service", proof: "review" };
const NOT_YET = new Set(["capture", "comparisons", "contributors", "design", "notifications", "paths", "research", "shared", "voice"]);

/**
 * The Studio address for an old Admin address, or null when it is already Studio's own.
 * "#/edit/posts/x.md" → "#/write/posts%2Fx.md"; "#/overview" → "#/"; "#/research" → "#/not-yet/research".
 */
export function legacyRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path, search = ""] = raw.split("?");
  const [name, ...rest] = path.split("/");
  const tail = search ? `?${search}` : "";
  if (name === "edit" && rest.length) {
    let file = rest.join("/");
    try { file = decodeURIComponent(file); } catch { /* as typed */ }
    const screen = OLD_FOLDERS[file.split("/")[0]] || "write";
    return `#/${screen}/${encodeURIComponent(file)}`;
  }
  if (name === "new") return rest[0] === "recipe" ? "#/write/new/recipe" : rest[0] === "page" ? "#/page/new" : rest[0] === "series" ? "#/collection/new" : "#/write";
  // The old inbox named the server's states; Studio's Comments names its own views.
  if ((name === "moderation" || name === "feedback") && rest.length) {
    const view = { pending: "", approved: "shown", rejected: "not-shown", removed: "taken-down" }[rest[0]] ?? "";
    return `#/comments${view ? `/${view}` : ""}${tail}`;
  }
  // R1: "Where it went" is a view of Sharing, and Share this job lives under it.
  if (name === "distribution") return `#/sharing?view=posts${search ? `&${search}` : ""}`;
  if (name === "share") return rest.length ? `#/sharing/job/${rest.join("/")}${tail}` : `#/sharing${tail}`;
  if (name in OLD_RENAMED) return OLD_RENAMED[name] ? `#/${OLD_RENAMED[name]}${rest.length ? `/${rest.join("/")}` : ""}${tail}` : "#/";
  if (NOT_YET.has(name)) return `#/not-yet/${name}`;
  return null;
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
    // An old Admin address opens its Studio screen, and the address bar says so.
    const studio = legacyRoute(hash);
    if (studio) {
      history.replaceState(null, "", studio);
      hash = studio;
    }
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

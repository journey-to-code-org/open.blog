// Hash routes → screens. `#/`, `#/posts`, `#/write`, `#/write/<path>`, `#/sign-in`.
// Before leaving a screen the router asks it (`leave()`), so unsaved work is never lost on the way.
import { readersRoute } from "./parts/reader-rules.js";

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
  overview: "", series: "collections", landing: "front-page", appearance: "look", seasons: "decorations", social: "sharing/accounts",
  announcements: "sharing", greetings: "cards",
};
const OLD_FOLDERS = { posts: "write", pages: "page", series: "collection", services: "service", proof: "review" };
/**
 * The old editor's panes and the Write sheet each opens: Settings is About this post (R5); Social,
 * Optimize and Accessibility are Before you publish, Release kit is Words for YouTube, Field review
 * is Your route (R7), Assistant is the Writing helper (R8). Evidence waits for R12 and opens the post.
 */
export const PANE_SHEETS = Object.freeze({ settings: "about", social: "ready", optimize: "ready", accessibility: "ready", release: "youtube", field: "route", assistant: "helper" });
const NOT_YET = new Set(["research", "shared"]);

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
    // R5/R7: a post's old panes open their sheet (PANE_SHEETS); others open the post.
    const sheet = screen === "write" && PANE_SHEETS[new URLSearchParams(search).get("pane")] ? `?sheet=${PANE_SHEETS[new URLSearchParams(search).get("pane")]}` : "";
    return `#/${screen}/${encodeURIComponent(file)}${sheet}`;
  }
  if (name === "new") return rest[0] === "recipe" ? "#/write/new/recipe" : rest[0] === "page" ? "#/page/new" : rest[0] === "series" ? "#/collection/new" : "#/write";
  // R10: Readers. The old inbox, feedback, analytics and Studio's own Comments and Visitors open it.
  const readers = readersRoute(name, rest, search);
  if (readers) return readers;
  // R1: "Where it went" is a view of Sharing, and Share this job lives under it.
  if (name === "distribution") return `#/sharing?view=posts${search ? `&${search}` : ""}`;
  // R2: the old accounts page, whatever was after it, is Your accounts.
  if (name === "social") return `#/${OLD_RENAMED.social}`;
  // R3: Notifications is Studio's own; whatever came after it (the old Admin had nothing there) goes.
  if (name === "notifications") return rest.length ? `#/notifications${tail}` : null;
  // R13: reading paths. #/paths and #/paths/new are Studio's own; the old editor address moves to #/path/<address>.
  if (name === "paths") {
    if (rest[0] === "edit" && rest[1]) return `#/path/${rest.slice(1).join("/")}${tail}`;
    return !rest.length || (rest.length === 1 && rest[0] === "new") ? null : `#/paths${tail}`;
  }
  // R13: readings side by side. The old comparisons editor moves under Research; #/research/readings… is Studio's
  // own, while plain #/research is still not yet.
  if (name === "comparisons") {
    if (rest[0] === "new" && rest.length === 1) return `#/research/readings/new${tail}`;
    if (rest[0] === "edit" && rest[1]) return `#/research/reading/${rest.slice(1).join("/")}${tail}`;
    return `#/research/readings${tail}`;
  }
  if (name === "research" && (rest[0] === "readings" || (rest[0] === "reading" && rest[1]))) return null;
  if (name === "share") return rest.length ? `#/sharing/job/${rest.join("/")}${tail}` : `#/sharing${tail}`;
  // R5: Contributors is People.
  if (name === "contributors") return `#/people${tail}`;
  // R4: Capture is New job, whatever came after it.
  if (name === "capture") return `#/new-job${tail}`;
  // R9: the old sample library is Your writing voice (#/voice), a sample is A piece, and Design a
  // theme is Describe a new look under Look. The old session was #/voice, which is now the hub's
  // own address: only a link that names a set (?pack=) is still known to be the old session's,
  // and it opens Write a piece with that set. Write a piece is the hub's first button.
  if (name === "voice" && rest[0] === "library") return rest.length > 1 ? `#/voice/piece/${rest.slice(1).join("/")}${tail}` : `#/voice${tail}`;
  if (name === "voice" && !rest.length && new URLSearchParams(search).has("pack")) return `#/voice/write${tail}`;
  if (name === "design") return `#/look/design${tail}`;
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

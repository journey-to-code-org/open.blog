// The frame around every screen: Zubra UI's dashboard-shell (sidebar on a wide screen, Menu on a
// phone), Find (the command palette), the account menu, toasts, and signing in again when a session
// runs out. Screens are { title, element, actions, leave, isDirty, palette }.
import { h, toast } from "./parts/dom.js";
import { use } from "./zubra.js";
import { createRouter, parseRoute } from "./router.js";
import { signInForm } from "./screens/signin.js";
import { SCREENS } from "./screens/index.js";
import { createPostsStore } from "./parts/store.js";
import { createUndo } from "./parts/undo.js";
import { ApiError } from "./api.js";
import { sayListDate } from "./parts/post-list.js";
import { registerWorker } from "./parts/push-here.js";
import { installPrompt } from "./parts/install-state.js";
import { menuLabel } from "./parts/install-rules.js";
import { herePhone } from "./parts/notification-rules.js";

const navFor = (meta) => SCREENS.filter((s) => s.nav && (!s.when || s.when(meta)) && (!s.navWhen || s.navWhen(meta))).map((s) => ({ id: s.name, label: s.nav, href: s.name === "home" ? "#/" : `#/${s.name}` }));
const AREA = Object.fromEntries(SCREENS.map((s) => [s.name, s.area]));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The account menu: the phone in her hand (Notifications, Add to Home Screen) before the rest. */
function accountMenu(meta) {
  const install = menuLabel(herePhone({ navigator, window: globalThis }), installPrompt.has());
  return [
    { value: "site", label: "View my site" },
    ...(meta.push ? [{ value: "notifications", label: "Notifications" }] : []),
    ...(install ? [{ value: "home-screen", label: install }] : []),
    { value: "tools", label: "More tools" },
    { value: "signout", label: "Sign out" },
  ];
}

export async function startShell(root, api, meta) {
  await use("dashboard-shell", "command-palette", "action-button", "modal-dialog", "toast-region");
  const NAV = navFor(meta);
  const siteName = meta.siteTitle || "Your site";
  rememberSiteName(siteName);
  // The name under the icon when she adds it to her Home Screen (the manifest says the same).
  const shortName = meta.siteTitle && meta.siteTitle.length <= 12 ? meta.siteTitle : "My blog";
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", shortName);
  const posts = createPostsStore(api);
  const context = { api, meta, siteName, posts, go: (hash) => router.go(hash) };
  // A change that alters what the site uses (naming a trade, say) shows its screens without a reload.
  context.refreshMeta = async () => {
    try {
      Object.assign(meta, await api.get("meta"));
      shell.nav = navFor(meta);
    } catch {
      // The next start reads it again.
    }
  };

  const undoSlot = h("div", { class: "studio-undo", "aria-live": "polite" });
  const screenHost = h("div");
  const content = h("main", { class: "studio-screen", id: "studio-main" }, undoSlot, screenHost);
  const actions = h("div", { class: "studio-actions", slot: "actions" });
  const find = h("action-button", { variant: "ghost", "aria-keyshortcuts": isMac ? "Meta+K" : "Control+K", onClick: () => openPalette() },
    "Find", h("span", { class: "studio-key", "aria-hidden": "true", text: isMac ? "⌘K" : "Ctrl K" }));
  const shell = h("dashboard-shell", {
    class: "studio-shell",
    product: siteName,
    heading: "",
    nav: NAV,
    current: "home",
    user: api.user,
    menu: accountMenu(meta),
    onMenuselect: (event) => account(event.detail),
  }, h("div", { slot: "actions", class: "studio-actions-wrap" }, actions, find), content);

  const palette = h("command-palette", { label: "Find", placeholder: "Find a post or something to do…", onSelect: (event) => runCommand(event.detail) });
  palette.addEventListener("openchange", (event) => { if (event.detail) refreshPalette(); });
  root.replaceChildren(shell, palette, h("toast-region", { position: globalThis.matchMedia?.("(max-width: 40rem)").matches ? "top-center" : "bottom-center", label: "Messages" }));

  // Signing in again: a dialog over the screen, so her words stay where they are.
  api.onSignedOut = () => new Promise((resolve, reject) => {
    let dialog = null;
    const was = document.activeElement;
    const back = () => setTimeout(() => was?.isConnected && was.focus?.(), 0);
    signInForm(api, {
      heading: "",
      intro: "You were signed out. Your words are safe; sign in and your blog will finish what it was doing.",
      onDone: () => { dialog.open = false; dialog.remove(); back(); resolve(); },
    }).then((form) => {
      dialog = h("modal-dialog", { label: "Sign in again", class: "studio-signin-dialog" }, h("span", { slot: "heading", text: "Sign in again" }), form);
      dialog.addEventListener("openchange", (event) => {
        if (!event.detail && dialog.isConnected) { dialog.remove(); back(); reject(new ApiError("Not saved: you're signed out. Your words are still here.", 401, { signedOut: true })); }
      });
      document.body.append(dialog);
      dialog.open = true;
    });
  });

  function account(choice) {
    if (choice === "site") open(meta.siteUrl || "/", "_blank", "noopener");
    if (choice === "tools") router.go("#/tools");
    if (choice === "notifications") router.go("#/notifications");
    if (choice === "home-screen") router.go("#/notifications?sheet=home-screen");
    if (choice === "signout") signOut();
  }

  async function signOut() {
    if (!(await router.current()?.leave?.() ?? true)) return;
    context.undo?.forget();
    await api.signOut();
    location.hash = "#/";
    location.reload();
  }

  let paletteScreen = [];
  function installItem() {
    const label = menuLabel(herePhone({ navigator, window: globalThis }), installPrompt.has());
    return label ? [{ id: "home-screen", label, group: "Do", href: "#/notifications?sheet=home-screen" }] : [];
  }
  const BASE = [
    ...NAV.map((item) => ({ id: `go-${item.id}`, label: item.label, group: "Go to", href: item.href })),
    { id: "write-recipe", label: "Write a new recipe", group: "Do", href: "#/write/new/recipe" },
    { id: "put-up", label: "Put a look up now", group: "Do", href: "#/decorations?do=putup" },
    { id: "write-story", label: "Write a new story", group: "Do", href: "#/write/new/story" },
    { id: "site", label: "View my site", group: "Do" },
    ...(meta.push ? [
      { id: "go-notifications", label: "Notifications", group: "Go to", href: "#/notifications" },
      { id: "notifications-here", label: "Turn on notifications here", group: "Do", href: "#/notifications" },
      { id: "notifications-test", label: "Send a test notification", group: "Do", href: "#/notifications" },
    ] : []),
    { id: "rebuild-all", label: "Rebuild the site now", group: "Do" },
    // "#/", not a bare /admin: the old Admin's bridge (G25) sends an installed app's bare launch back here.
    { id: "old-admin", label: "Open the old Admin", group: "Do", hint: "Everything not in Studio yet", href: "/admin/#/" },
    { id: "signout", label: "Sign out", group: "Do" },
  ];
  // The screen's own items first; a shell item with the same words isn't listed twice.
  const withBase = (screenItems) => [...screenItems, ...BASE.filter((b) => !screenItems.some((s) => s.label === b.label)), ...installItem()];
  async function refreshPalette() {
    let items = [];
    try {
      items = await posts.list();
    } catch {
      // The palette still offers everything else.
    }
    palette.items = [
      ...(context.undo?.has() ? [{ id: "undo", label: "Undo the delete", group: "Do" }] : []),
      ...withBase(router.current()?.palette || paletteScreen),
      ...items.filter((p) => p.status !== "error").map((p) => ({
        id: `post:${p.path}`, label: p.title || p.path, group: "Posts", href: `#/write/${encodeURIComponent(p.path)}`,
        hint: p.status === "draft" ? "Draft" : p.status === "scheduled" ? `Scheduled ${sayListDate(p.date)}` : "Published",
      })),
    ];
  }
  function openPalette() {
    palette.open = true; // openchange refreshes the posts
  }

  // Keys that work anywhere in Studio (command-palette handles Ctrl/⌘ K itself): Save, Publish. Save never falls through to the
  // browser's "Save page", even when nothing on this screen can be saved.
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "s" && key !== "enter") return;
    const screen = router.current();
    const id = key === "s" ? "save" : "publish";
    if (key === "s") event.preventDefault();
    if (!(screen?.palette?.some((item) => item.id === id) || screen?.keys?.includes(id)) || palette.open || document.querySelector("modal-dialog[open]")) return;
    event.preventDefault();
    screen.command(id);
  });
  function runCommand(id) {
    if (id === "site") account("site");
    else if (id === "signout") signOut();
    else if (id === "undo") context.undo?.restore();
    else if (id === "rebuild-all") {
      api.post("rebuild", {}).then(
        () => toast("Your site is up to date."),
        (error) => toast(`Your site couldn't be updated. Your work is saved. (${error.status || "no connection"}: ${error.message || ""})`, { variant: "warning", duration: 0 }),
      );
    }
    else router.current()?.command?.(id);
  }

  const router = createRouter({
    // Whether a screen applies is asked as it opens, so a refreshed meta counts at once.
    screens: Object.fromEntries(SCREENS.map((s) => [s.name, (route) => (!s.when || s.when(meta) ? s.create(context, route) : SCREENS[0].create(context, { name: "home", arg: "", query: {} }))])),
    async onShow(screen, route) {
      shell.current = AREA[route.name] || "home";
      shell.heading = screen.title;
      document.title = `${screen.title} · ${siteName}`;
      screenHost.replaceChildren(screen.element);
      actions.replaceChildren(...(screen.actions || []));
      paletteScreen = screen.palette || [];
      palette.items = withBase(paletteScreen);
      await screen.load?.();
      if (context.undo?.takeFocus()) return;
      if (screen.focus) screen.focus();
      else content.querySelector("h1, h2")?.focus?.();
    },
  });
  context.replaceRoute = (hash) => router.replace(hash);
  // The browser offering to install changes what the account menu says.
  addEventListener("beforeinstallprompt", () => setTimeout(() => { shell.menu = accountMenu(meta); }, 0));
  addEventListener("appinstalled", () => { shell.menu = accountMenu(meta); toast("Added."); });
  // The blog's one worker (it only shows notifications, so registering early is harmless), and a
  // tapped notification asking this window to move: through the router, so the leave-guard asks.
  registerWorker(navigator, globalThis)?.catch(() => {});
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const hash = event.data?.type === "open" && typeof event.data.hash === "string" ? event.data.hash : "";
    if (/^#\/[^\s]*$/.test(hash) && hash.length <= 500) router.go(hash);
  });
  navigator.serviceWorker?.startMessages?.();
  context.undo = await createUndo({ api, posts, slot: undoSlot, onRestored: () => router.current()?.reload?.() });
  context.setTitle = (title) => { shell.heading = title; document.title = `${title} · ${siteName}`; };
  context.setActions = (nodes) => actions.replaceChildren(...nodes);
  context.toast = toast;
  context.route = () => parseRoute(location.hash);
  await router.start();
}

function rememberSiteName(name) {
  try {
    localStorage.setItem("studio:site-name", name);
  } catch {
    // Only the sign-in page's heading uses it.
  }
}

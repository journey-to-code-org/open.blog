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

const NAV = SCREENS.filter((s) => s.nav).map((s) => ({ id: s.name, label: s.nav, href: s.name === "home" ? "#/" : `#/${s.name}` }));
const AREA = Object.fromEntries(SCREENS.map((s) => [s.name, s.area]));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export async function startShell(root, api, meta) {
  await use("dashboard-shell", "command-palette", "action-button", "modal-dialog", "toast-region");
  const siteName = meta.siteTitle || "Your site";
  rememberSiteName(siteName);
  const posts = createPostsStore(api);
  const context = { api, meta, siteName, posts, go: (hash) => router.go(hash) };

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
    menu: [{ value: "site", label: "View my site" }, { value: "signout", label: "Sign out" }],
    onMenuselect: (event) => account(event.detail),
  }, h("div", { slot: "actions", class: "studio-actions-wrap" }, actions, find), content);

  const palette = h("command-palette", { label: "Find", placeholder: "Find a post or something to do…", onSelect: (event) => runCommand(event.detail) });
  palette.addEventListener("openchange", (event) => { if (event.detail) refreshPalette(); });
  root.replaceChildren(shell, palette, h("toast-region", { position: "bottom-center", label: "Messages" }));

  // Signing in again: a dialog over the screen, so her words stay where they are.
  api.onSignedOut = () => new Promise((resolve, reject) => {
    let dialog = null;
    const was = document.activeElement;
    const back = () => setTimeout(() => was?.isConnected && was.focus?.(), 0);
    signInForm(api, {
      heading: "",
      intro: "You were signed out. Your words are safe; sign in and Studio will finish what it was doing.",
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
  const BASE = [
    ...NAV.map((item) => ({ id: `go-${item.id}`, label: item.label, group: "Go to", href: item.href })),
    { id: "write", label: "Write something new", group: "Do", href: "#/write" },
    { id: "site", label: "View my site", group: "Do" },
    { id: "old-admin", label: "Open the old Admin", group: "Do", hint: "Everything not in Studio yet", href: "/admin" },
    { id: "signout", label: "Sign out", group: "Do" },
  ];
  async function refreshPalette() {
    let items = [];
    try {
      items = await posts.list();
    } catch {
      // The palette still offers everything else.
    }
    palette.items = [
      ...paletteScreen,
      ...BASE,
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
    if (!screen?.palette?.some((item) => item.id === id) || palette.open || document.querySelector("modal-dialog[open]")) return;
    event.preventDefault();
    screen.command(id);
  });
  function runCommand(id) {
    if (id === "site") account("site");
    else if (id === "signout") signOut();
    else router.current()?.command?.(id);
  }

  const router = createRouter({
    screens: Object.fromEntries(SCREENS.map((s) => [s.name, (route) => s.create(context, route)])),
    async onShow(screen, route) {
      shell.current = AREA[route.name] || "home";
      shell.heading = screen.title;
      document.title = `${screen.title} · ${siteName}`;
      screenHost.replaceChildren(screen.element);
      actions.replaceChildren(...(screen.actions || []));
      paletteScreen = screen.palette || [];
      palette.items = [...paletteScreen, ...BASE];
      await screen.load?.();
      if (screen.focus) screen.focus();
      else content.querySelector("h1, h2")?.focus?.();
    },
  });
  context.replaceRoute = (hash) => router.replace(hash);
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

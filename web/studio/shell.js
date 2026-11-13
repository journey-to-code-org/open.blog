// The frame around every screen: Zubra UI's dashboard-shell (sidebar on a wide screen, Menu on a
// phone), Find (the command palette), the account menu, toasts, and signing in again when a session
// runs out. Screens are { title, element, actions, leave, isDirty, palette }.
import { h, toast } from "./parts/dom.js";
import { use } from "./zubra.js";
import { createRouter, parseRoute } from "./router.js";
import { signInForm } from "./screens/signin.js";
import { createHome } from "./screens/home.js";
import { createPosts } from "./screens/posts.js";
import { createWrite } from "./screens/write.js";
import { sayWhen } from "./parts/dates.js";

const NAV = [
  { id: "home", label: "Home", href: "#/" },
  { id: "posts", label: "Posts", href: "#/posts" },
];
const AREA = { home: "home", posts: "posts", write: "posts" };
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export async function startShell(root, api, meta) {
  await use("dashboard-shell", "command-palette", "action-button", "modal-dialog", "toast-region");
  const siteName = meta.siteTitle || "Your site";
  const context = { api, meta, siteName, go: (hash) => router.go(hash) };

  const content = h("div", { class: "studio-screen" });
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
    signInForm(api, {
      heading: "Sign in again",
      intro: "You were signed out. Your words are safe; sign in and Studio will finish what it was doing.",
      onDone: () => { dialog.open = false; dialog.remove(); resolve(); },
    }).then((form) => {
      dialog = h("modal-dialog", { label: "Sign in again", class: "studio-signin-dialog" }, form);
      dialog.addEventListener("openchange", (event) => {
        if (!event.detail && dialog.isConnected) { dialog.remove(); reject(new Error("Not saved: you're signed out.")); }
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
    await api.signOut();
    location.hash = "#/";
    location.reload();
  }

  let paletteScreen = [];
  const BASE = [
    { id: "go-home", label: "Home", group: "Go to", href: "#/" },
    { id: "go-posts", label: "Posts", group: "Go to", href: "#/posts" },
    { id: "write", label: "Write something new", group: "Do", href: "#/write" },
    { id: "site", label: "View my site", group: "Do" },
    { id: "old-admin", label: "Open the old Admin", group: "Do", hint: "Everything not in Studio yet", href: "/admin" },
    { id: "signout", label: "Sign out", group: "Do" },
  ];
  async function refreshPalette() {
    let posts = [];
    try {
      posts = (await api.get("documents?kind=posts")).items || [];
    } catch {
      // The palette still offers everything else.
    }
    palette.items = [
      ...paletteScreen,
      ...BASE,
      ...posts.filter((p) => p.status !== "error").map((p) => ({
        id: `post:${p.path}`, label: p.title || p.path, group: "Posts", href: `#/write/${encodeURIComponent(p.path)}`,
        hint: p.status === "draft" ? "Draft" : p.status === "scheduled" ? `Scheduled ${sayWhen(p.date)}` : "Published",
      })),
    ];
  }
  function openPalette() {
    refreshPalette();
    palette.open = true;
  }
  function runCommand(id) {
    if (id === "site") account("site");
    else if (id === "signout") signOut();
    else router.current()?.command?.(id);
  }

  const router = createRouter({
    screens: {
      home: () => createHome(context),
      posts: () => createPosts(context),
      write: (route) => createWrite(context, route.arg),
    },
    async onShow(screen, route) {
      shell.current = AREA[route.name] || "home";
      shell.heading = screen.title;
      document.title = `${screen.title} · ${siteName}`;
      content.replaceChildren(screen.element);
      actions.replaceChildren(...(screen.actions || []));
      paletteScreen = screen.palette || [];
      palette.items = [...paletteScreen, ...BASE];
      await screen.load?.();
      screen.focus?.() ?? content.querySelector("h1, h2")?.focus?.();
    },
  });
  context.setTitle = (title) => { shell.heading = title; document.title = `${title} · ${siteName}`; };
  context.setActions = (nodes) => actions.replaceChildren(...nodes);
  context.toast = toast;
  context.route = () => parseRoute(location.hash);
  await router.start();
}

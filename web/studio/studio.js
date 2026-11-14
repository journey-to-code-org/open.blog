// Start-up: is someone signed in? Then the shell and the screen asked for; otherwise sign in first,
// and come back to that screen afterwards.
import { createApi } from "./api.js";
import { use } from "./zubra.js";
import { startShell } from "./shell.js";
import { showSignIn } from "./screens/signin.js";
import { listenForInstall } from "./parts/install-state.js";
import { configureWords } from "./parts/words.js";

// The browser's "Install" question can come at any moment from the start: keep it for Add to Home
// Screen (Studio R3).
listenForInstall(globalThis);

const api = createApi();

// Zubra UI's modal-dialog and side-sheet put a <header> inside their <dialog>, which counts as a
// second page banner (axe: landmark-no-duplicate-banner). Until that's fixed upstream, Studio
// marks those headers as plain groups.
new MutationObserver(() => {
  for (const header of document.querySelectorAll("dialog header:not([role])")) header.setAttribute("role", "none");
}).observe(document.body, { childList: true, subtree: true });
const root = document.getElementById("studio");

// With no signal (R4 G35), Studio opens from the worker's copy with the last `meta` and who was
// signed in, kept here: so New job keeps a job on a roof. Never the session itself; sending waits
// for a signal and asks the server again.
const LAST = "studio:last-start";

function remembered() {
  try {
    const kept = JSON.parse(localStorage.getItem(LAST) || "null");
    return kept && typeof kept.user === "string" && kept.user && kept.meta && typeof kept.meta === "object" ? kept : null;
  } catch {
    return null;
  }
}

function remember(user, meta) {
  try {
    localStorage.setItem(LAST, JSON.stringify({ user, meta }));
  } catch {
    // Without room for it, Studio still opens whenever there's a signal.
  }
}

async function start() {
  await use("toast-region", "loading-spinner");
  // The site's words (docs/studio-words.md) before anything is drawn: the last ones kept on this
  // phone for sign-in and no signal, then the server's.
  configureWords(remembered()?.meta?.studioWords);
  try {
    await api.session();
  } catch (error) {
    const last = error.status === 0 ? remembered() : null;
    if (last) {
      api.user = last.user;
      configureWords(last.meta.studioWords);
      await startShell(root, api, last.meta);
      return;
    }
    if (error.status !== 401) {
      root.replaceChildren(document.createTextNode(error.message));
      return;
    }
    await showSignIn(root, api, { heading: "Sign in" });
  }
  const meta = await api.get("meta");
  remember(api.user, meta);
  configureWords(meta.studioWords);
  await startShell(root, api, meta);
}

start();

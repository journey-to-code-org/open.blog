// Start-up: is someone signed in? Then the shell and the screen asked for; otherwise sign in first,
// and come back to that screen afterwards.
import { createApi } from "./api.js";
import { use } from "./zubra.js";
import { startShell } from "./shell.js";
import { showSignIn } from "./screens/signin.js";

const api = createApi();

// Zubra UI's modal-dialog and side-sheet put a <header> inside their <dialog>, which counts as a
// second page banner (axe: landmark-no-duplicate-banner). Until that's fixed upstream, Studio
// marks those headers as plain groups.
new MutationObserver(() => {
  for (const header of document.querySelectorAll("dialog header:not([role])")) header.setAttribute("role", "none");
}).observe(document.body, { childList: true, subtree: true });
const root = document.getElementById("studio");

async function start() {
  await use("toast-region", "loading-spinner");
  try {
    await api.session();
  } catch (error) {
    if (error.status !== 401) {
      root.replaceChildren(document.createTextNode(error.message));
      return;
    }
    await showSignIn(root, api, { heading: "Sign in" });
  }
  const meta = await api.get("meta");
  await startShell(root, api, meta);
}

start();

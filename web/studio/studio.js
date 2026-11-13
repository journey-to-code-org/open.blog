// Start-up: is someone signed in? Then the shell and the screen asked for; otherwise sign in first,
// and come back to that screen afterwards.
import { createApi } from "./api.js";
import { use } from "./zubra.js";
import { startShell } from "./shell.js";
import { showSignIn } from "./screens/signin.js";

const api = createApi();
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

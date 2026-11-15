// Start-up: is someone signed in? Then the shell and the screen asked for; otherwise sign in first,
// and come back to that screen afterwards.
import { createApi } from "./api.js";
import { use } from "./zubra.js";
import { startShell } from "./shell.js";
import { showSignIn } from "./screens/signin.js";
import { listenForInstall } from "./parts/install-state.js";
import { configureWords } from "./parts/words.js";
import { clearVoiceCopies } from "./parts/voice-copies.js";
import { joinProblem, joinToken } from "./parts/join-rules.js";
import { hasJoinToken, holdJoinToken, readInvitation, showJoinPage, showJoinRefused, signInFirstWords } from "./screens/together-join.js";
import { say } from "./parts/words.js";
import { toast } from "./parts/dom.js";

// An invitation link (Studio R14a): the token is taken out of the address, and out of history,
// before anything else runs or any request is made. It is kept only in memory.
const invitation = joinToken(location.hash);
if (invitation) {
  holdJoinToken(invitation.token);
  history.replaceState(null, "", invitation.hash);
}

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

let joinIntro = "";
let justJoined = false;
/**
 * Signed out with an invitation in hand: someone new chooses a password and is in (true); someone
 * who already signs in is asked to sign in as that name first (false, with the words to say).
 */
async function joinFirst() {
  if (!hasJoinToken()) return false;
  let view;
  try {
    view = await readInvitation(api);
  } catch (error) {
    await new Promise((resolve) => showJoinRefused(root, joinProblem(error), resolve));
    return false;
  }
  if (!view.newAccount) {
    joinIntro = signInFirstWords(view.signInName);
    return false;
  }
  const joined = await showJoinPage(root, api, view);
  if (!joined) {
    await new Promise(() => {}); // they said no thanks: the page says so, and nothing more opens
  }
  history.replaceState(null, "", `#/together/${encodeURIComponent(joined)}`);
  justJoined = true;
  return true;
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
    if (!(await joinFirst())) await showSignIn(root, api, { heading: "Sign in", intro: joinIntro });
    // R9: someone signed in here. Voice writing another person left on this phone goes; her own
    // (a sign-in that ran out mid-piece) is kept and offered back. As the old Admin did.
    clearVoiceCopies(() => globalThis.localStorage, { keepUser: api.user });
  }
  const meta = await api.get("meta");
  remember(api.user, meta);
  configureWords(meta.studioWords);
  await startShell(root, api, meta);
  if (justJoined) toast(say("join.joined"));
}

start();

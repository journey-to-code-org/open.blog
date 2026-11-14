// The browser's own "Install" question (beforeinstallprompt), kept from the moment Studio starts
// (studio.js) so Add to Home Screen can ask it when she presses Add it. Studio R3.
let saved = null;
let fired = false;
const installed = new Set();

/** Listen from the start: keep the question, stop the browser's own mini bar, and hear "installed". */
export function listenForInstall(target = globalThis) {
  target.addEventListener?.("beforeinstallprompt", (event) => {
    event.preventDefault();
    saved = event;
    fired = true;
  });
  target.addEventListener?.("appinstalled", () => {
    saved = null;
    for (const then of installed) then();
  });
}

export const installPrompt = {
  /** Whether the browser can ask right now. */
  has: () => Boolean(saved),
  /** Whether it ever offered to (for details). */
  fired: () => fired,
  /** Ask; resolves "accepted", "dismissed", or null when it can't ask. A question can be asked once. */
  async ask() {
    const event = saved;
    if (!event) return null;
    saved = null;
    await event.prompt();
    const choice = await event.userChoice.catch(() => null);
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  },
  /** Run `then` when the app is installed; returns a way to stop. */
  onInstalled(then) {
    installed.add(then);
    return () => installed.delete(then);
  },
};

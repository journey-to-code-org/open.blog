// Which release of Studio is where, for Details (Studio R4): the worker's kept copy, the page running
// now (release.js, which the server writes) and the server's (the first line of /admin/sw.js), and
// Clear saved pages, which deletes Studio's kept copies and reloads. It never unregisters the worker
// and never touches the jobs kept on this phone (IndexedDB). The words are in parts/worker-rules.js.
import { releaseLines, scriptRelease } from "./worker-rules.js";

const ASK_MS = 1500;
const SERVER_MS = 5000;

/** The worker's release, or "" when no worker is in charge or it doesn't answer. */
function askWorker(win) {
  const controller = win.navigator?.serviceWorker?.controller;
  if (!controller || typeof win.MessageChannel !== "function") return Promise.resolve("");
  return new Promise((resolve) => {
    const channel = new win.MessageChannel();
    const timer = setTimeout(() => resolve(""), ASK_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(typeof event.data?.version === "string" ? event.data.version : "");
    };
    controller.postMessage({ type: "release" }, [channel.port2]);
  });
}

/** `{ lines, mismatch }` for Details. Never throws. */
export async function readReleases(win = globalThis) {
  const [page, worker, server] = await Promise.all([
    import("../release.js").then((module) => String(module.RELEASE || ""), () => ""),
    askWorker(win).catch(() => ""),
    win.fetch("/admin/sw.js", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout?.(SERVER_MS) })
      .then((response) => (response.ok ? response.text() : ""))
      .then(scriptRelease, () => ""),
  ]);
  return releaseLines({ worker, page, server });
}

/** Delete Studio's kept copies (only caches named studio-…) and reload from the server. */
export async function clearSavedPages(win = globalThis) {
  for (const name of await win.caches.keys()) if (name.startsWith("studio-")) await win.caches.delete(name);
  win.location.reload();
}

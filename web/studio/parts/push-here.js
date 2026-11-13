// This phone's notifications (Studio R3): the one worker, this browser's sign-up, and turning on,
// off and on again. Nothing here draws; the screen says what happened. `navigator` and `window` are
// passed in so tests can stand in for a phone. docs/specs/studio/r3/ux.md, "Turn on notifications".
//
// Safety: the sign-up's address goes only to push/devices; this phone is found on the list by
// endpointHash. Turning off removes it on the server before the sign-up is dropped.
import { endpointHash, keyBytes, sameKey } from "./notification-rules.js";

export const WORKER = "/admin/sw.js";
export const SCOPE = "/admin/";

/** Why turning on stopped before the server: dismissed, denied, worker or refused. */
export class PushStop extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Registers the blog's one worker: exactly /admin/sw.js with scope /admin/, so it is the same
 * registration installs and sign-ups already have. Only in a secure context; never anything else.
 */
export function registerWorker(nav = globalThis.navigator, win = globalThis) {
  if (!nav?.serviceWorker || win?.isSecureContext === false) return Promise.resolve(null);
  return nav.serviceWorker.register(WORKER, { scope: SCOPE });
}

export function createPushHere({ api, navigator: nav = globalThis.navigator, window: win = globalThis }) {
  async function registration() {
    return (await nav?.serviceWorker?.getRegistration?.(SCOPE).catch(() => null)) || null;
  }

  async function subscription() {
    const reg = await registration();
    return (await reg?.pushManager?.getSubscription().catch(() => null)) || null;
  }

  /** This browser's sign-up, its hash, and its entry on the server's list. */
  async function findMine(devices = []) {
    const current = await subscription();
    if (!current) return { subscription: null, hash: null, mine: null };
    const hash = await endpointHash(current.endpoint);
    return { subscription: current, hash, mine: devices.find((d) => d.device === hash) || null };
  }

  /**
   * Turn on. Call straight from the press: the phone is asked before anything is awaited (Safari
   * refuses a question asked later). Resolves { device, tested } where `tested` is true or the
   * test's error; throws PushStop before the server, or the server's error.
   */
  function turnOn({ publicKey, label, kinds, ask = true, test = true }) {
    const Notification = win.Notification;
    const answer = Notification.permission === "granted" || !ask ? Promise.resolve(Notification.permission) : Notification.requestPermission();
    return (async () => {
      const permission = await answer;
      if (permission === "denied") throw new PushStop("denied");
      if (permission !== "granted") throw new PushStop("dismissed");
      let reg;
      try {
        reg = await registerWorker(nav, win);
        await nav.serviceWorker.ready;
      } catch {
        throw new PushStop("worker");
      }
      if (!reg?.pushManager) throw new PushStop("worker");
      let current;
      try {
        current = await reg.pushManager.getSubscription();
        if (current && !sameKey(current, publicKey)) {
          await current.unsubscribe();
          current = null;
        }
        current ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      } catch {
        throw new PushStop("refused");
      }
      const reply = await api.post("push/devices", { subscription: current.toJSON(), label, kinds });
      let tested = true;
      if (test) try {
        await api.post("push/test", { id: reply.device.id });
      } catch (error) {
        if (error?.status === 401) throw error;
        tested = error;
      }
      return { device: reply.device, tested };
    })();
  }

  /** Turn off: off the server's list first, then the sign-up goes. */
  async function turnOff(mine) {
    if (mine) await api.post(`push/devices/${mine.id}/remove`, {});
    const current = await subscription();
    await current?.unsubscribe().catch(() => false);
  }

  /** Undo a turn-off: sign up again without asking, with the same name and kinds. */
  async function undo({ publicKey, label, kinds }) {
    if (win.Notification?.permission !== "granted") throw new PushStop("dismissed");
    return turnOn({ publicKey, label, kinds, ask: false, test: false });
  }

  return { registration, subscription, findMine, turnOn, turnOff, undo };
}

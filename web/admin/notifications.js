// <ob-notifications>: the Notifications screen (ADR 0412). The owner turns notifications on for the
// phone or computer she is holding, picks what it hears about (new comments, reader feedback, quote
// requests, her other apps), sends it a test, and sees and removes the other devices that get them.
//
// The browser's subscription goes to the Admin server, which hands it to the hosted push function;
// this page never sees a key or the database, and the server never sends an endpoint back: a
// device is matched to this browser by a hash of its endpoint, worked out here. Every control is a
// native button, input or checkbox with a visible label; status is words, never colour alone.

import { el } from "./block-forms.js";

let uid = 0;

export const OFF_TEXT = Object.freeze({
  off: "Notifications are not set up. They're optional; the site works the same without them. To turn them on, follow docs/notifications.md, then set OPENBLOG_PUSH_ENDPOINT and OPENBLOG_PUSH_ADMIN_KEY where Admin runs.",
  invalid: "Admin's notification settings are not valid, so notifications stay off. Fix these settings, then reload:",
  unavailable: "Admin reached the push function, but notifications aren't switched on there. Set OPENBLOG_PUSH_ENABLED=true and the other settings in its environment.",
});

/** What this browser can do: "unsupported", "install-first" (an iPhone not opened from the Home Screen), "denied" or "ready". */
export function browserState({ navigator: nav = globalThis.navigator, window: win = globalThis } = {}) {
  const apple = /iphone|ipad|ipod/i.test(nav?.userAgent || "") || (nav?.platform === "MacIntel" && nav?.maxTouchPoints > 1);
  const standalone = win.matchMedia?.("(display-mode: standalone)")?.matches || nav?.standalone === true;
  const capable = Boolean(nav?.serviceWorker) && "PushManager" in win && "Notification" in win;
  if (!capable) return apple && !standalone ? "install-first" : "unsupported";
  if (win.Notification.permission === "denied") return "denied";
  return "ready";
}

/** A name for this device to start from, which the owner can change. */
export function guessLabel(userAgent = "") {
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/android/i.test(userAgent)) return /mobile/i.test(userAgent) ? "Android phone" : "Android tablet";
  if (/macintosh/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows computer";
  if (/cros/i.test(userAgent)) return "Chromebook";
  return "This browser";
}

/** The hash the server lists a device under: SHA-256 of the endpoint, first 32 hex digits. */
export async function endpointHash(endpoint, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const keyBytes = (base64url) => {
  const plain = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
};

const ago = (iso, now) => {
  if (!iso) return "nothing sent yet";
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 2) return "last buzzed just now";
  if (minutes < 90) return `last buzzed ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `last buzzed ${hours} hours ago`;
  return `last buzzed ${Math.round(hours / 24)} days ago`;
};

/** Registers Admin's service worker; it only shows notifications, so doing it early is harmless. */
export function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav?.serviceWorker) return;
  nav.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
}

export function createNotifications({ api, navigator: nav = globalThis.navigator, window: win = globalThis, now = () => Date.now() }) {
  const root = el("ob-notifications", { class: "oba-notifications", "data-notifications": "true" });
  const ids = `oba-notifications-${++uid}`;
  let state = null;
  let busy = false;
  let picked = null;
  let label = guessLabel(nav?.userAgent);

  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", tabindex: "-1" });
  const say = (text, error = false) => {
    status.className = `oba-small${error ? " oba-error" : ""}`;
    status.setAttribute("role", error ? "alert" : "status");
    status.textContent = text;
  };

  async function subscription() {
    const registration = await nav.serviceWorker.getRegistration("/admin/");
    return (await registration?.pushManager.getSubscription()) || null;
  }

  async function load() {
    root.replaceChildren(el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Notifications"), el("p", { class: "oba-small", role: "status" }, "Loading…"));
    try {
      const overview = await api.call("GET", "push/status");
      let mine = null;
      const browser = browserState({ navigator: nav, window: win });
      if (overview.enabled && browser === "ready") {
        const current = await subscription().catch(() => null);
        if (current) {
          const hash = await endpointHash(current.endpoint);
          mine = overview.devices.find((d) => d.device === hash) || null;
        }
      }
      state = { overview, browser, mine };
      picked = picked || new Set(mine?.kinds || overview.kinds?.map((k) => k.id).filter((k) => k !== "app" || overview.otherApps) || []);
    } catch (error) {
      state = null;
      root.replaceChildren(el("h2", {}, "Notifications"), el("p", { class: "oba-error", role: "alert" }, error.message || "Couldn't load notifications. Try again in a moment."));
      return;
    }
    render();
  }

  async function act(text, work, done) {
    if (busy) return;
    busy = true;
    say(`${text}…`);
    try {
      const result = await work();
      busy = false;
      await done?.(result);
    } catch (error) {
      busy = false;
      say(error.message || "That didn't work. Try again.", true);
    }
  }

  async function turnOn() {
    const permission = await win.Notification.requestPermission();
    if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked for this site. Allow them in the browser's settings, then try again." : "Notifications weren't allowed. Tap the button again and choose Allow.");
    const registration = await nav.serviceWorker.register("/admin/sw.js", { scope: "/admin/" });
    await nav.serviceWorker.ready;
    const current = (await registration.pushManager.getSubscription())
      || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.overview.publicKey) }));
    const reply = await api.call("POST", "push/devices", { json: { subscription: current.toJSON(), label, kinds: [...picked] } });
    await api.call("POST", "push/test", { json: { id: reply.device.id } });
    return reply;
  }

  async function turnOff() {
    const current = await subscription();
    if (state.mine) await api.call("POST", `push/devices/${state.mine.id}/remove`, { json: {} });
    await current?.unsubscribe();
  }

  function kindChoices({ onChange }) {
    const kinds = state.overview.kinds.filter((k) => k.id !== "app" || state.overview.otherApps);
    return el("fieldset", { class: "oba-notifications-kinds" },
      el("legend", {}, "Tell me about"),
      kinds.map((kind) => {
        const id = `${ids}-kind-${kind.id}`;
        return el("label", { class: "oba-notifications-kind", for: id },
          el("input", { type: "checkbox", id, "data-kind": kind.id, checked: picked.has(kind.id), onChange: (event) => {
            if (event.target.checked) picked.add(kind.id);
            else picked.delete(kind.id);
            onChange?.();
          } }),
          ` ${kind.label}`);
      }));
  }

  function thisDevice() {
    const heading = el("h3", { id: `${ids}-here` }, "This device");
    const { browser, mine } = state;
    if (browser === "install-first") {
      return el("section", { "aria-labelledby": `${ids}-here` }, heading,
        el("p", {}, "On an iPhone or iPad, notifications only work from the Home Screen. In Safari, tap the Share button, choose Add to Home Screen, then open Admin from its new icon and come back here."));
    }
    if (browser === "unsupported") {
      return el("section", { "aria-labelledby": `${ids}-here` }, heading, el("p", {}, "This browser can't get notifications. Try Chrome, Edge, Firefox or Safari."));
    }
    if (browser === "denied") {
      return el("section", { "aria-labelledby": `${ids}-here` }, heading, el("p", {}, "Notifications are blocked for this site in this browser. Allow them in the browser's site settings, then reload this page."));
    }
    if (mine) {
      return el("section", { "aria-labelledby": `${ids}-here` }, heading,
        el("p", {}, `${mine.label} gets notifications; ${ago(mine.lastSentAt, now())}.`),
        kindChoices({ onChange: () => act("Saving", () => api.call("POST", `push/devices/${mine.id}`, { json: { kinds: [...picked] } }), (reply) => { state.mine = reply.device; say(picked.size ? "Saved." : "Saved. Nothing is picked, so this device won't buzz."); }) }),
        el("div", { class: "oba-toolbar" },
          el("button", { class: "oba-btn", type: "button", "data-action": "test", onClick: () => act("Sending a test", () => api.call("POST", "push/test", { json: { id: mine.id } }), () => say("Sent. It should show up in a few seconds.")) }, "Send a test"),
          el("button", { class: "oba-btn", type: "button", "data-action": "turn-off", onClick: () => act("Turning off", turnOff, async () => { picked = null; await load(); say("Off. This device won't get notifications."); }) }, "Turn off on this device"),
        ));
    }
    const nameId = `${ids}-label`;
    return el("section", { "aria-labelledby": `${ids}-here` }, heading,
      el("p", {}, "Get a buzz on this device when there's something for you, even when Admin is closed."),
      el("label", { for: nameId }, "Call this device"),
      el("input", { id: nameId, type: "text", maxlength: "60", value: label, "data-field": "label", onInput: (event) => { label = event.target.value; } }),
      kindChoices({}),
      el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "turn-on", onClick: () => act("Turning on", turnOn, async () => { await load(); say("On. A test notification is on its way."); }) }, "Turn on notifications"));
  }

  function otherDevices() {
    const others = state.overview.devices.filter((d) => d.id !== state.mine?.id);
    if (!others.length) return null;
    const names = Object.fromEntries(state.overview.kinds.map((k) => [k.id, k.label.toLowerCase()]));
    return el("section", { "aria-labelledby": `${ids}-others` },
      el("h3", { id: `${ids}-others` }, "Other devices"),
      el("ul", { class: "oba-notifications-devices" }, others.map((d) =>
        el("li", { "data-device": d.id },
          el("p", {}, el("strong", {}, d.label), `: ${d.kinds.length ? d.kinds.map((k) => names[k] || k).join(", ") : "nothing picked"}; ${ago(d.lastSentAt, now())}.`),
          el("button", { class: "oba-btn", type: "button", "data-action": "remove", onClick: () => act(`Removing ${d.label}`, () => api.call("POST", `push/devices/${d.id}/remove`, { json: {} }), async () => { await load(); say(`Removed ${d.label}. It won't get notifications.`); }) }, `Remove ${d.label}`)))));
  }

  function render() {
    const overview = state.overview;
    const title = el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Notifications");
    if (!overview.enabled) {
      const problems = overview.problems?.length ? el("ul", {}, overview.problems.map((p) => el("li", {}, el("code", {}, p)))) : null;
      root.replaceChildren(...[title, el("p", {}, OFF_TEXT[overview.state] || OFF_TEXT.off), problems].filter(Boolean));
      return;
    }
    root.replaceChildren(...[
      title,
      el("p", { class: "oba-small" }, "A notification says what arrived and who sent it, and opens the right page in Admin when you tap it. Comments and feedback still wait for you to approve them."),
      status,
      thisDevice(),
      otherDevices(),
    ].filter(Boolean));
  }

  return {
    element: root,
    load,
    isDirty: () => false,
    isBusy: () => busy,
    destroy: () => {},
  };
}

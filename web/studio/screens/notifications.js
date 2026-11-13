// Notifications (#/notifications, Studio R3): "Should this phone tell me when someone writes, and
// about what?" The phone in her hand in every state (off, asking, on, not allowed, Home Screen
// first, needs a newer iOS, inside another app, not secure, can't), its switches, Send a test,
// Rename, Turn off with Undo; her other phones and computers (test, change, rename, remove); not set
// up and errors; and the Add to Home Screen sheet (?sheet=home-screen). docs/specs/studio/r3/ux.md.
import { h, toast as defaultToast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { createSheet, guardedLeave } from "../parts/sheet.js";
import { detailsBox } from "../parts/account-details.js";
import { createHomeScreen } from "../parts/home-screen-sheet.js";
import { createPushHere, PushStop } from "../parts/push-here.js";
import { deviceCard, openChangeSheet, renameDialog } from "../parts/notification-cards.js";
import { createHereCard } from "../parts/notification-here.js";
import * as R from "../parts/notification-rules.js";

export async function createNotifications(context, route = { query: {} }) {
  const { api, meta = {} } = context;
  const toast = context.toast || defaultToast;
  await use("action-button", "alert-banner", "dropdown-menu", "empty-state", "modal-dialog", "side-sheet", "skeleton-block", "status-badge", "text-field", "toggle-switch");
  const push = createPushHere({ api, navigator, window: globalThis });
  const sheet = await createSheet({ label: "Notifications" });
  let here = R.herePhone({ navigator, window: globalThis });
  const homeScreen = createHomeScreen({ sheet, here, toast });
  let pending = { ...route.query };
  let overview = null; // GET push/status
  let found = { subscription: null, hash: null, mine: null };
  let picked = null; // the switches before turning on
  let loadedOnce = false;

  const heading = h("h2", { id: "studio-notifications-h", class: "studio-visually-hidden", tabindex: "-1", text: "Notifications" });
  const lede = h("p", { class: "studio-lede", text: R.ledeWords(["comment"]) });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite", tabindex: "-1" });
  const undoSlot = h("div", { class: "studio-notifications-undo" });
  const top = h("div", { class: "studio-banner" });
  const main = h("div", { class: "studio-account-main", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const othersHeading = h("h3", { id: "studio-others-h", tabindex: "-1", text: "Other phones and computers" });
  const side = h("div", { class: "studio-account-side" });
  const element = h("section", { class: "studio-page studio-notifications", "aria-labelledby": "studio-notifications-h" },
    heading, lede, status, undoSlot, top, h("div", { class: "studio-account-columns" }, main, side));

  const say = (words) => { status.textContent = words; };
  const offered = () => R.offeredKinds(meta, overview || {});
  const limit = () => overview?.limits?.devices || 20;
  const others = () => (overview?.devices || []).filter((d) => d.id !== found.mine?.id);

  const card = createHereCard({
    here: () => here, api, push, overview: () => overview, found: () => found, offered, limit, say, toast,
    picked: () => picked ?? offered(), setPicked: (kinds) => { picked = kinds; },
    reload: () => load(),
    homeScreen: (opener) => homeScreen.open({ opener }),
    turnedOff: (kept) => showUndo(kept),
    othersHeading: () => othersHeading,
  });

  async function load() {
    here = R.herePhone({ navigator, window: globalThis });
    if (meta.push !== true) return drawOff({ state: "off" });
    main.setAttribute("aria-busy", "true");
    if (!loadedOnce) main.replaceChildren(h("skeleton-block", { shape: "card" }));
    try {
      // The phone's own sign-up is read at the same time as the list, without waiting.
      const [reply, mineOf] = await Promise.all([api.get("push/status"), push.findMine([]).catch(() => ({ subscription: null, hash: null, mine: null }))]);
      overview = reply;
      found = { ...mineOf, mine: mineOf.hash ? (overview.devices || []).find((d) => d.device === mineOf.hash) || null : null };
    } catch (error) {
      if (error.status === 401) throw error;
      main.removeAttribute("aria-busy");
      main.replaceChildren(h("alert-banner", { variant: "danger", heading: "Notifications didn't load" }, R.pushTrouble(error, { during: "load" }), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      side.replaceChildren(detailsBox([`HTTP ${error.status}`, error.data?.code ? `code ${error.data.code}` : "", error.message]));
      return;
    }
    loadedOnce = true;
    if (!overview.enabled) return drawOff(overview);
    draw();
    followLink();
  }

  function drawOff(state) {
    main.removeAttribute("aria-busy");
    lede.textContent = R.ledeWords(R.offeredKinds(meta, {}));
    if (state.state === "invalid" || state.state === "unavailable") {
      main.replaceChildren(h("alert-banner", { variant: "warning", heading: "Notifications aren't set up right" }, "Tell the person who set up your site."));
      side.replaceChildren(detailsBox(state.state === "invalid"
        ? ["These settings aren't valid:", ...(state.problems || [])]
        : ["The push function answered but isn't switched on: set OPENBLOG_PUSH_ENABLED=true and its other settings there."]));
    } else {
      main.replaceChildren(h("empty-state", { heading: "Notifications aren't set up for your blog" }, "The person who set up your site can turn them on. Your blog works the same without them."));
      side.replaceChildren(detailsBox(["Set OPENBLOG_PUSH_ENDPOINT and OPENBLOG_PUSH_ADMIN_KEY where Studio runs, after the steps in docs/notifications.md."]));
    }
    followLink();
  }

  function draw() {
    main.removeAttribute("aria-busy");
    lede.textContent = R.ledeWords(offered());
    if (!offered().length && !found.mine) {
      main.replaceChildren(h("empty-state", { heading: "There's nothing for notifications to tell you about yet" }, "They tell you about comments and quote requests, and neither is turned on for your blog."));
    } else {
      main.replaceChildren(card.draw());
    }
    const list = others().sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || ""));
    side.replaceChildren(othersHeading,
      list.length
        ? h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-others-h" }, ...list.map((d) => deviceCard(d, { now: Date.now(), on: deviceActions })))
        : h("p", { class: "studio-help", text: "No other phones or computers get notifications. Turn them on from each one you use." }),
      detailsBox([
        `${(overview.devices || []).length} of ${limit()} phones and computers`,
        `kinds offered here: ${offered().join(", ") || "none"}`,
        `kinds the server knows: ${(overview.kinds || []).map((k) => `${k.id} (${k.label})`).join(", ")}`,
        `other apps (OPENBLOG_PUSH_NOTIFY_KEY): ${overview.otherApps ? "yes" : "no"}`,
        "New keys stop every phone; each turns them on again.",
        "On a host that sleeps (Render's free plan), tapping a notification opens Studio slowly; the notification itself isn't late.",
      ]));
  }

  // ---- other phones and computers ---------------------------------------------------------------

  const deviceActions = {
    async test(device) {
      try {
        await api.post("push/test", { id: device.id });
        say(`Sent to ${device.label}. Check that it showed up there.`);
      } catch (error) {
        if (error.status === 401) throw error;
        const words = R.pushTrouble(error, { during: "other-test", name: device.label });
        if (error.status === 410 || error.status === 404) await load();
        say(words);
      }
    },
    change(device, opener) {
      openChangeSheet({
        sheet, device, offered: offered(), held: device.kinds, opener,
        save: async (kinds) => {
          try {
            await api.post(`push/devices/${device.id}`, { kinds: R.keptKinds(kinds, offered(), device.kinds) });
          } catch (error) {
            if (error.status === 401) throw error;
            throw new Error(R.pushTrouble(error, { during: "save", name: device.label }));
          }
          await load();
          say(R.savedKindsWords(kinds, device.label));
          focusDevice(device.id);
        },
      });
    },
    async rename(device, opener) {
      const label = await renameDialog({ title: `Rename ${device.label}`, label: device.label, save: async (value) => {
        try {
          await api.post(`push/devices/${device.id}`, { label: value });
        } catch (error) {
          if (error.status === 401) throw error;
          throw new Error(R.pushTrouble(error, { during: "rename", name: device.label }));
        }
      } });
      if (!label) { opener?.focus?.(); return; }
      await load();
      say(`Renamed to “${label}”.`);
      focusDevice(device.id);
    },
    async remove(device, opener) {
      const choice = await ask({
        heading: `Remove ${device.label}?`,
        text: "It won't get notifications from your blog any more. To get them there again, open your blog on it and turn them on.",
        choices: [{ label: "Keep it", value: "keep", variant: "secondary" }, { label: "Remove", value: "go", variant: "destructive" }],
      });
      if (choice !== "go") { opener?.focus?.(); return; }
      const at = others().findIndex((d) => d.id === device.id);
      try {
        await api.post(`push/devices/${device.id}/remove`, {});
      } catch (error) {
        if (error.status === 401) throw error;
        say(R.pushTrouble(error, { during: "remove", name: device.label }));
        return;
      }
      await load();
      say(`Removed ${device.label}.`);
      const next = others()[Math.min(at, others().length - 1)];
      requestAnimationFrame(() => (next ? element.querySelector(`#studio-device-${CSS.escape(next.id)}`) : othersHeading).focus());
    },
  };

  function focusDevice(id) {
    requestAnimationFrame(() => (element.querySelector(`#studio-device-${CSS.escape(id)}`) || othersHeading).focus());
  }

  // ---- Undo after turning off --------------------------------------------------------------------

  function showUndo(kept) {
    const button = h("action-button", { variant: "secondary", size: "sm", onClick: async () => {
      button.loading = true;
      try {
        await push.undo({ publicKey: overview.publicKey, label: kept.label, kinds: kept.kinds });
        undoSlot.replaceChildren();
        await load();
        say("On again.");
        card.focusHeading();
      } catch (error) {
        button.loading = false;
        if (error?.status === 401) throw error;
        undoSlot.replaceChildren();
        say(error instanceof PushStop ? "Turn them on again with Turn on notifications." : R.pushTrouble(error, { during: "on", noun: R.deviceNoun(here), limit: limit() }));
      }
    } }, "Undo");
    undoSlot.replaceChildren(h("p", { class: "studio-help" }, "Turned off by mistake? ", button));
  }

  // ---- links, and coming back from Settings --------------------------------------------------------

  function followLink() {
    const query = pending;
    pending = {};
    if (Object.keys(query).length) context.replaceRoute?.("#/notifications");
    if (query.sheet === "home-screen") homeScreen.open({ opener: heading });
  }

  const refresh = () => {
    if (!element.isConnected) return stopWatching();
    if (document.visibilityState === "visible" && !card.busy()) load();
  };
  let permissionStatus = null;
  document.addEventListener("visibilitychange", refresh);
  navigator.permissions?.query?.({ name: "notifications" }).then((p) => { permissionStatus = p; p.addEventListener("change", refresh); }, () => {});
  const stopWatching = () => {
    document.removeEventListener("visibilitychange", refresh);
    permissionStatus?.removeEventListener("change", refresh);
  };

  return {
    title: "Notifications",
    element,
    load,
    reload: load,
    leave: async () => { const ok = await guardedLeave(sheet); if (ok) stopWatching(); return ok; },
    isDirty: () => sheet.isDirty(),
    focus: () => heading.focus(),
    get palette() {
      const items = [];
      const state = overview?.enabled ? R.hereState(here, found.mine, Boolean(found.subscription)) : null;
      if (state === "off") items.push({ id: "turn-on", label: "Turn on notifications here", group: "Notifications" });
      if (state === "on") items.push({ id: "test", label: "Send a test notification", group: "Notifications" });
      return items;
    },
    command(id) {
      if (id === "turn-on") card.pressPrimary();
      if (id === "test") card.pressPrimary();
    },
  };
}


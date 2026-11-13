// Notifications' "This iPhone" card (Studio R3): the phone in her hand in every state, its switches
// (saved at once when on), Turn on (asking the phone inside the press), Send a test, Rename, Turn
// off, Check again, and Mikey's details. Errors show on the card (role=alert), linked from the
// button that failed. docs/specs/studio/r3/ux.md, "This iPhone: every state".
import { h } from "./dom.js";
import { detailsBox } from "./account-details.js";
import { kindSwitches, renameDialog } from "./notification-cards.js";
import { PushStop, SCOPE } from "./push-here.js";
import * as R from "./notification-rules.js";

const ASKING_MS = 8000;
const LOCK_SCREEN = "They show who wrote and their first few words, even on your lock screen.";

/** `ctx`: here(), api, push, overview(), found(), offered(), limit(), say, toast, picked(), setPicked, reload, homeScreen(opener), turnedOff(kept), othersHeading(). */
export function createHereCard(ctx) {
  const { api, push, say, toast } = ctx;
  let busy = false;
  let primary = null;
  let heading = null;
  let trouble = null;
  let workerLines = [];

  const noun = () => R.deviceNoun(ctx.here());
  const This = () => `This ${noun()}`;

  /** Show what went wrong on the card and point the button at it; focus goes to the button. */
  function fail(words, button = primary) {
    if (!trouble) return say(words);
    trouble.textContent = words;
    trouble.hidden = false;
    button?.setAttribute("aria-describedby", trouble.id);
    requestAnimationFrame(() => (button?.querySelector?.("button") || button)?.focus?.());
  }
  const clear = () => { if (trouble) { trouble.textContent = ""; trouble.hidden = true; } };

  function focusHeading() {
    requestAnimationFrame(() => document.getElementById("studio-here-h")?.focus());
  }

  // ---- what she does --------------------------------------------------------------------------

  /** Turn on. Runs straight from the press, so the phone's question comes before any await. */
  function turnOn(button) {
    if (busy) return;
    const overview = ctx.overview();
    const found = ctx.found();
    busy = true;
    clear();
    button.loading = true;
    button.setAttribute("aria-busy", "true");
    say("Turning on…");
    // Where the server already has this phone, her name and choices stay (never a new guess).
    const { label, kinds } = R.turnOnChoices({
      mine: found.mine, guess: R.guessLabel(navigator.userAgent), picked: ctx.picked(), offered: ctx.offered(),
      devices: (overview.devices || []).filter((d) => d.device !== found.hash),
    });
    const asking = Notification.permission === "default";
    const hint = asking ? setTimeout(() => say(ctx.here().desktop
      ? `Your ${noun()} is asking. Choose Allow. Don't see the question? Look for a bell at the right end of the address bar and click it.`
      : `Your ${noun()} is asking. Choose Allow.`), ASKING_MS) : null;
    let pending;
    try {
      pending = push.turnOn({ publicKey: overview.publicKey, label, kinds });
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(async (result) => {
      clearTimeout(hint);
      busy = false;
      await ctx.reload();
      say(result.tested === true ? `On. A test is on its way to this ${noun()}.` : "On. The test didn't come through, though. Press Send a test in a minute.");
      toast("Notifications are on.");
      focusHeading();
    }, async (error) => {
      clearTimeout(hint);
      busy = false;
      button.loading = false;
      button.removeAttribute("aria-busy");
      if (error instanceof PushStop && error.reason === "denied") {
        await ctx.reload();
        say(R.stopWords("denied"));
        return focusHeading();
      }
      if (error instanceof PushStop) {
        say("");
        return fail(R.stopWords(error.reason, noun()), button);
      }
      say("");
      const words = error?.data?.signedOut ? error.message : R.pushTrouble(error, { during: "on", noun: noun(), limit: ctx.limit() });
      if (error?.status === 409) {
        fail(words, button);
        requestAnimationFrame(() => ctx.othersHeading()?.focus());
        return;
      }
      fail(words, button);
    });
  }

  async function sendTest(button) {
    if (busy) return;
    busy = true;
    clear();
    button.loading = true;
    const mine = ctx.found().mine;
    try {
      await api.post("push/test", { id: mine.id });
      say("Sent. It should show up in a few seconds.");
    } catch (error) {
      if (error.status === 401) throw error;
      const words = R.pushTrouble(error, { during: "test", noun: noun() });
      if (error.status === 410 || error.status === 404) {
        busy = false;
        await ctx.reload();
        say(words);
        return focusHeading();
      }
      fail(words, button);
    } finally {
      busy = false;
      button.loading = false;
    }
  }

  async function turnOff(button) {
    if (busy) return;
    busy = true;
    clear();
    button.loading = true;
    const mine = ctx.found().mine;
    const kept = { label: mine.label, kinds: mine.kinds };
    try {
      await push.turnOff(mine);
    } catch (error) {
      busy = false;
      button.loading = false;
      if (error.status === 401) throw error;
      return fail(R.pushTrouble(error, { during: "remove", noun: noun(), name: This() }), button);
    }
    busy = false;
    ctx.setPicked(null);
    await ctx.reload();
    say(`Off. This ${noun()} won't get notifications.`);
    toast("Turned off.");
    ctx.turnedOff(kept);
    requestAnimationFrame(() => (primary?.querySelector("button") || primary)?.focus());
  }

  async function takeOffList(button) {
    const mine = ctx.found().mine;
    if (!mine || busy) return;
    busy = true;
    button.loading = true;
    try {
      await api.post(`push/devices/${mine.id}/remove`, {});
      busy = false;
      await ctx.reload();
      say(`Taken off the list. This ${noun()} won't get notifications.`);
      focusHeading();
    } catch (error) {
      busy = false;
      button.loading = false;
      if (error.status === 401) throw error;
      fail(R.pushTrouble(error, { during: "remove", noun: noun(), name: This() }), button);
    }
  }

  async function rename(opener) {
    const mine = ctx.found().mine;
    const label = await renameDialog({ title: `Rename this ${noun()}`, label: mine.label, save: async (value) => {
      try {
        await api.post(`push/devices/${mine.id}`, { label: value });
      } catch (error) {
        if (error.status === 401) throw error;
        throw new Error(R.pushTrouble(error, { during: "rename", noun: noun(), name: This() }));
      }
    } });
    if (!label) { opener?.focus?.(); return; }
    await ctx.reload();
    say(`Renamed to “${label}”.`);
    focusHeading();
  }

  /** A switch while on: saved at once, every kind not shown kept; it flips back if saving fails. */
  async function saveKinds(switches, kinds, before) {
    const mine = ctx.found().mine;
    switches.busy(true);
    say("Saving…");
    try {
      const reply = await api.post(`push/devices/${mine.id}`, { kinds: R.keptKinds(kinds, ctx.offered(), mine.kinds) });
      Object.assign(mine, reply.device || {});
      say(R.savedKindsWords(kinds, This()));
    } catch (error) {
      switches.set(before);
      say("");
      if (error.status === 401) throw error;
      fail(R.pushTrouble(error, { during: "save", noun: noun(), name: This() }), null);
    } finally {
      switches.busy(false);
    }
  }

  // ---- what she sees ----------------------------------------------------------------------------

  function draw() {
    const here = ctx.here();
    const found = ctx.found();
    const overview = ctx.overview();
    const state = R.hereState(here, found.mine, Boolean(found.subscription));
    const badge = R.stateBadge(state);
    heading = h("h3", { id: "studio-here-h", class: "studio-comment-who", tabindex: "-1", text: This() });
    trouble = h("p", { id: "studio-here-trouble", class: "studio-comment-trouble", role: "alert", hidden: true });
    primary = null;
    const parts = [];
    const full = (label, onClick, variant = "primary") => h("action-button", { variant, class: "studio-wide-button", onClick: (event) => onClick(event.currentTarget) }, label);

    if (state === "off") {
      if (found.subscription && !found.mine) parts.push(h("p", { text: `This ${noun()} was taken off your list, so it's off.` }));
      const switches = kindSwitches({ offered: ctx.offered(), picked: ctx.picked(), onChange: (kinds) => ctx.setPicked(kinds) });
      parts.push(switches.element);
      primary = full("Turn on notifications", (button) => turnOn(button));
      parts.push(primary);
      if (here.permission === "default") parts.push(h("p", { class: "studio-help", text: `Your ${noun()} will ask first. ${here.desktop ? "Click" : "Tap"} Allow.` }));
      parts.push(h("p", { class: "studio-help", text: LOCK_SCREEN }));
    } else if (state === "on") {
      const mine = found.mine;
      const renameButton = h("button", { type: "button", class: "studio-link-button", "aria-label": `Rename this ${noun()}`, onClick: (event) => rename(event.currentTarget) }, "Rename");
      parts.push(h("p", {}, `This ${noun()} is called “`, h("span", { class: "studio-account-name", text: mine.label }), "”. ", renameButton));
      parts.push(h("p", { class: "studio-help", text: R.lastToldWords(mine.lastSentAt) }));
      let before = ctx.offered().filter((k) => mine.kinds.includes(k));
      const switches = kindSwitches({ offered: ctx.offered(), picked: before, onChange: async (kinds) => {
        const was = before;
        before = kinds;
        await saveKinds(switches, kinds, was);
        before = switches.picked();
      } });
      parts.push(switches.element);
      primary = full("Send a test", (button) => sendTest(button));
      parts.push(primary, h("p", { class: "studio-help", text: LOCK_SCREEN }));
      parts.push(h("details", { class: "studio-help" }, h("summary", { text: "Didn't see the test?" }), h("ul", {}, ...R.didntSeeIt(here).map((line) => h("li", { text: line })))));
      parts.push(h("div", { class: "studio-own-line" }, full(`Turn off on this ${noun()}`, (button) => turnOff(button), "secondary")));
    } else if (state === "denied") {
      parts.push(h("p", { text: R.stateWords(state, here) }), h("ol", { class: "studio-steps" }, ...R.deniedSteps(here).map((step) => h("li", { text: step }))), h("p", { text: "Then come back here." }));
      primary = full("Check again", async () => {
        await ctx.reload();
        const now = R.hereState(ctx.here(), ctx.found().mine, Boolean(ctx.found().subscription));
        say(now === "denied" ? "Still not allowed. Follow the steps above, then come back." : "Allowed now. Turn notifications on when you're ready.");
        focusHeading();
      });
      parts.push(primary);
      if (found.mine) parts.push(h("div", { class: "studio-own-line" }, full(`Take this ${noun()} off the list`, (button) => takeOffList(button), "secondary")));
    } else if (state === "home-screen-first") {
      parts.push(h("p", { text: R.stateWords(state, here) }));
      primary = full("Add your blog to your Home Screen", (button) => ctx.homeScreen(button));
      parts.push(primary);
    } else if (state === "in-app") {
      const address = `${location.origin}/admin/studio/`;
      const code = h("code", { class: "studio-mono studio-address", text: address });
      parts.push(h("p", { text: R.stateWords(state, here) }), h("p", {}, code));
      primary = full("Copy the address", () => {
        const select = () => {
          const range = document.createRange();
          range.selectNodeContents(code);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
          say("Select the address and copy it.");
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(address).then(() => say(`Copied. Paste it into ${here.android ? "Chrome" : "Safari"}'s address bar.`), select);
        else select();
      });
      parts.push(primary);
    } else {
      parts.push(h("p", { text: R.stateWords(state, here) }));
    }

    readWorker();
    return h("div", { class: "studio-comment studio-here", "data-state": state },
      h("div", { class: "studio-comment-head" }, heading, badge ? h("status-badge", { variant: badge[1] }, badge[0]) : null),
      trouble,
      ...parts,
      detailsBox(detailLines(state, here, found, overview)));
  }

  function detailLines(state, here, found, overview) {
    const key = overview?.publicKey || "";
    let host = "";
    try { host = found.subscription ? new URL(found.subscription.endpoint).host : ""; } catch { /* none */ }
    return [
      `hereState: ${state}`,
      `isSecureContext: ${here.secure}`,
      `display mode: ${here.standalone ? "standalone" : "browser"}`,
      `Notification.permission: ${here.permission}`,
      `iOS: ${here.ios ?? "no"}; browser: ${here.browser}; in-app: ${here.inApp}`,
      ...workerLines,
      found.subscription ? `push service: ${host}` : "no subscription here",
      found.subscription ? `key match: ${R.sameKey(found.subscription, key) ? "yes" : "no"} (${key.slice(0, 6)}…${key.slice(-6)})` : "",
      found.mine ? `device id: ${found.mine.id}` : "",
      found.hash ? `hash: ${found.hash}` : "",
      found.mine ? `created: ${found.mine.createdAt}` : "",
      `user agent: ${here.userAgent}`,
    ];
  }

  // The worker's scope, script and state, for details (read after drawing; shown on the next draw).
  function readWorker() {
    push.registration().then((reg) => {
      const worker = reg?.active || reg?.waiting || reg?.installing;
      workerLines = reg ? [`worker scope: ${reg.scope}`, `worker script: ${worker?.scriptURL || "?"}`, `worker state: ${worker?.state || "?"}`] : [`worker: none registered at ${SCOPE}`];
    }, () => {});
  }

  return {
    draw,
    busy: () => busy,
    focusHeading,
    /** The palette's "Turn on notifications here" / "Send a test notification". */
    pressPrimary: () => (primary?.querySelector("button") || primary)?.click?.(),
  };
}

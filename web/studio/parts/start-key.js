// Getting started, step: Turn on your writing helper (Studio R9b). Shown only when the site has
// no usable key. R8's key rules hold exactly: the key is write-only (`keyShape`, `keyFieldAllowed`,
// `settingsRequest`); the field is emptied before the request is built, so from then the key
// exists only in the request being sent; it is refused over plain http; it is never put in the
// page again, in a toast, a log or storage; a request that fails for a signed-out session is not
// held or sent again. A key the company refuses is cleared at once, so a bad key never sits there.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { helperProblem } from "./helper-rules.js";
import { PROVIDERS, formCompany, formDestination, keyFieldAllowed, keyShape, keyState, providerId, settingsRequest } from "./helper-settings-rules.js";
import { keyNeedsHelper, neverSetUp } from "./onboarding-rules.js";

/**
 * `{ element, load(), primary(), hasKeyTyped(), clearKey(), leave(), focus() }`. `frame` is the
 * start screen's: `{ bar(primary, extras), done(state), status(words) }`. `done("done" |
 * "skipped")` settles the step and moves on.
 */
export async function createStartKey({ api, frame, location = globalThis.location }) {
  await use("action-button", "text-field", "alert-banner");
  let settings = null; // assistant/settings: never holds a key
  let status = null;
  let anyway = false;
  let busy = false;
  let accepted = false;
  const allowed = keyFieldAllowed(location);

  const key = h("text-field", { label: say("start.keyLabel"), description: say("start.keyHelp"), type: "password", autocomplete: "new-password", class: "studio-start-key" });
  const keyInput = () => key.querySelector("input");
  const said = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const body = h("div", { class: "studio-start-body" });
  const detailsLine = h("p", { class: "studio-mono" });
  const element = h("div", { class: "studio-start-step" }, body);
  const saveButton = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => save() }, say("start.keySave"));
  const nextButton = h("action-button", { onClick: () => frame.done(accepted ? "done" : "skipped") }, say("start.next"));
  const skip = h("action-button", { variant: "secondary", onClick: async () => { if (await leave()) frame.done("skipped"); } }, say("start.keySkip"));

  // A site whose helper was never set up gets the default company; one already chosen is kept.
  const provider = () => (neverSetUp(settings) ? "anthropic" : providerId(settings?.provider || status?.providerType));
  const endpoint = () => (neverSetUp(settings) ? "" : settings?.generationEndpoint);
  const company = () => formCompany({ provider: provider(), generationEndpoint: endpoint() }) || PROVIDERS[provider()]?.company || "";
  const typed = () => String(keyInput()?.value ?? key.value ?? "");
  /** Nothing of the key is left in the page. */
  function clearKey() {
    key.value = "";
    const input = keyInput();
    if (input) input.value = "";
  }
  key.addEventListener("valuechange", () => { key.error = ""; if (anyway) { anyway = false; paintBar(); } });
  // The browser's own attributes on the box itself: never offered to autofill, never corrected.
  requestAnimationFrame(() => { const input = keyInput(); if (input) { input.setAttribute("autocapitalize", "off"); input.setAttribute("autocorrect", "off"); input.setAttribute("spellcheck", "false"); } });

  function paintBar() {
    if (accepted) { nextButton.textContent = say("start.keyNext"); frame.bar(nextButton); return; }
    if (!allowed || keyNeedsHelper(status, settings)) { nextButton.textContent = say("start.next"); frame.bar(nextButton); return; }
    saveButton.textContent = anyway ? say("start.keySaveAnyway") : say("start.keySave");
    frame.bar(saveButton);
  }

  function paint() {
    const where = company();
    const anthropic = provider() === "anthropic";
    const site = PROVIDERS.anthropic.keysAt;
    detailsLine.textContent = say("start.keyState", { company: where || "—", model: String(settings?.model || PROVIDERS[provider()]?.defaultModel || "—"), destination: formDestination({ provider: provider(), generationEndpoint: endpoint() }) || "—", state: keyState(settings || {}).words.join(" ") });
    const details = h("details", { class: "studio-voice-details" }, h("summary", { text: say("common.forHelper") }), detailsLine);
    if (!allowed) {
      fill(body, h("p", { text: say("start.keyInsecure") }), said, details);
    } else if (keyNeedsHelper(status, settings)) {
      fill(body, h("p", { text: say("start.keyNeedsHelper") }), said, details);
    } else {
      fill(body,
        h("p", { class: "studio-lede", text: say("start.keyLede", { company: where }) }),
        h("p", { text: say("start.keyWhat", { company: where }) }),
        key, said,
        h("details", { class: "studio-start-where" }, h("summary", { text: say("start.keyWhere") }),
          anthropic
            ? h("ol", { class: "studio-steps" }, h("li", { text: say("start.keyStep1", { site }) }), h("li", { text: say("start.keyStep2") }), h("li", { text: say("start.keyStep3") }), h("li", { text: say("start.keyStep4") }))
            : h("p", { text: say("start.keyWhereOther") })),
        accepted ? null : h("div", { class: "studio-row" }, skip),
        details);
    }
    paintBar();
  }

  async function load() {
    [status, settings] = await Promise.all([api.get("assistant/status"), api.get("assistant/settings")]);
    paint();
  }

  /** Remove a key the company refused, if it is the one just saved: a bad key never sits there. */
  async function clearSaved() {
    try {
      const fresh = await api.get("assistant/settings");
      settings = await api.call("PUT", "assistant/settings", { json: settingsRequest({ provider: fresh.provider, generationEndpoint: fresh.generationEndpoint, model: fresh.model, etag: fresh.etag }, { remove: true }), retry: false });
    } catch (error) {
      if (error?.status === 401) throw error;
      // It stays saved; the helper's own screen says the key was refused.
    }
  }

  async function save() {
    if (busy || !settings || accepted) return;
    key.error = "";
    const pasted = typed();
    if (!pasted.trim()) { key.error = say("start.keyEmpty"); keyInput()?.focus(); return; }
    const shape = keyShape(provider(), pasted);
    if (!shape.ok && (shape.problem === "too-long" || !anyway)) {
      // The field keeps what she pasted so she can look again; nothing has been sent.
      key.error = shape.problem === "too-long" ? say("start.keyTooLong") : say("start.keyShape", { company: company() });
      if (shape.problem !== "too-long") { anyway = true; paintBar(); }
      keyInput()?.focus();
      return;
    }
    // Empty the field first: from here the key exists only in the request being sent.
    clearKey();
    anyway = false;
    busy = true;
    saveButton.loading = true;
    said.textContent = say("start.keySaving");
    const model = (neverSetUp(settings) ? "" : String(settings.model || "")) || PROVIDERS[provider()]?.defaultModel || "";
    const request = settingsRequest({ provider: provider(), generationEndpoint: endpoint(), model, etag: settings.etag, key: pasted });
    try {
      // `retry: false`: if her sign-in ran out, the request (and the key in it) is not held while
      // she signs in again, and is never sent a second time by itself.
      settings = await api.call("PUT", "assistant/settings", { json: request, retry: false });
    } catch (error) {
      busy = false;
      saveButton.loading = false;
      clearKey();
      const code = error?.data?.code;
      if (error?.status === 401) { said.textContent = say("start.keySignedOut"); api.onSignedOut?.().then(() => load().catch(() => {}), () => {}); return; }
      if (error?.status === 409) { said.textContent = say("start.keyChanged"); await load().catch(() => {}); said.textContent = say("start.keyChanged"); keyInput()?.focus(); return; }
      if (code === "insecure") { fill(body, h("p", { text: say("start.keyInsecure") }), said); said.textContent = ""; nextButton.textContent = say("start.next"); frame.bar(nextButton); return; }
      said.textContent = error?.status === 0 ? say("start.keyNoSignal") : say("start.keyNotSaved");
      paintBar();
      return;
    } finally {
      // Whatever happened, nothing of the key is left in the page.
      clearKey();
    }
    said.textContent = say("start.keyChecking", { company: company() });
    let outcome = "later";
    try {
      // Her press of the button that saves and checks the key is her word (nothing of the site goes).
      await api.call("POST", "assistant/check", { json: { confirmed: true } });
      outcome = "accepted";
    } catch (error) {
      if (error?.status === 401) throw error;
      if (helperProblem(error, { company: company() }).code === "key-rejected") outcome = "rejected";
    }
    busy = false;
    saveButton.loading = false;
    if (outcome === "rejected") {
      await clearSaved();
      said.textContent = say("start.keyRejected", { company: company() });
      paintBar();
      keyInput()?.focus();
      return;
    }
    accepted = true;
    status = await api.get("assistant/status").catch(() => status);
    paint();
    said.textContent = outcome === "accepted" ? say("start.keyAccepted", { company: company() }) : say("start.keyCheckLater");
    requestAnimationFrame(() => nextButton.querySelector("button")?.focus());
  }

  /** Leaving with something typed asks once; the question never shows it. Resolves true to go. */
  async function leave() {
    if (!typed().trim()) return true;
    const choice = await ask({ heading: say("start.keyLeaveAsk"), text: say("start.keyLeaveText"),
      choices: [{ label: say("start.keyLeaveGo"), value: "go", variant: "secondary" }, { label: say("start.keyLeaveStay"), value: "stay" }], focus: 1 });
    if (choice !== "go") { keyInput()?.focus(); return false; }
    clearKey();
    return true;
  }

  return {
    element,
    load,
    primary: () => (accepted || !allowed || keyNeedsHelper(status, settings) ? frame.done(accepted ? "done" : "skipped") : save()),
    hasKeyTyped: () => Boolean(typed().trim()),
    clearKey,
    leave,
    isDirty: () => Boolean(typed().trim()),
    focus: () => {},
  };
}

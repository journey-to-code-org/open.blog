// Connection (Studio R8), under For {helper} on the Writing helper screen: the company, the model,
// a custom address, and the key.
//
// The key is write-only. This page never receives one: the server answers only whether one is
// set and where from. The key field is empty on load and after every answer; it is emptied before
// the request is built, so the key is in exactly one place on its way out (the request body) and
// never in a message, a status, the console, the leave question, storage or the page afterwards.
// It is refused over plain http, here and on the server.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { helperProblem } from "./helper-rules.js";
import {
  formCompany, formDestination, keyFieldAllowed, keyShape, keyShapeWords, keyState, providerId, providerOptions, PROVIDERS, settingsFormProblem, settingsProblem, settingsRequest,
} from "./helper-settings-rules.js";

/**
 * `{ element, load(), hasKeyTyped(), clearKey(), focusCompany() }`. `onChanged()` runs after a save,
 * so the screen reads the helper's state again.
 */
export function createConnection({ api, onChanged }) {
  const company = h("select-field", { label: say("hsetup.company"), options: providerOptions(), value: "anthropic", "data-setting": "provider" });
  const model = h("text-field", { label: say("hsetup.model"), "data-setting": "model", maxlength: 200, autocomplete: "off" });
  const address = h("text-field", { label: say("hsetup.address"), description: say("hsetup.addressHelp"), "data-setting": "address", type: "url", maxlength: 2048, autocomplete: "off", inputmode: "url", hidden: true });
  const keyLine = h("p", { class: "studio-help studio-key-state", id: "studio-key-state", role: "status", "aria-live": "polite" });
  // Never filled from anywhere: `new-password` keeps a password manager from offering her
  // sign-in password, and the field has no "show" button.
  const key = h("text-field", { label: say("hsetup.newKey"), type: "password", name: "helper-key", autocomplete: "new-password", "data-setting": "key" });
  const keyHelp = h("p", { class: "studio-help", id: "studio-key-help" });
  const insecure = h("alert-banner", { variant: "warning", hidden: true }, say("hsetup.insecure"));
  const billed = h("p", { class: "studio-help" });
  const status = h("p", { class: "studio-help studio-row-note", role: "status", "aria-live": "polite" });
  const serverSaid = h("p", { class: "studio-help studio-mono", hidden: true });
  const saveLabel = h("span", { text: say("hsetup.save") });
  const save = h("action-button", { class: "studio-key-save", onClick: () => saveNow() }, saveLabel);
  const check = h("action-button", { variant: "secondary", onClick: () => checkNow() }, say("hsetup.checkIt"));
  const remove = h("action-button", { variant: "secondary", hidden: true, onClick: () => removeKey() }, say("hsetup.removeKey"));
  const element = h("section", { class: "studio-helper-section studio-connection", "aria-labelledby": "studio-connection-h" },
    h("h3", { id: "studio-connection-h", text: say("hsetup.connection") }),
    company, model, address,
    h("h4", { text: say("hsetup.key") }), keyLine, insecure, key, keyHelp,
    h("cluster-layout", { gap: "0.5rem" }, save, check, remove), status, serverSaid, billed);

  let settings = null; // assistant/settings: never holds a key
  let anyway = false; // Save it anyway, for one press, after a key that doesn't look right
  let busy = false;
  const allowed = keyFieldAllowed(globalThis.location || {});

  /** The inner input of the key field, with what a text-field doesn't set itself. */
  function keyInput() {
    const input = key.querySelector("input");
    if (input && !input.dataset.guarded) {
      input.dataset.guarded = "1";
      input.setAttribute("spellcheck", "false");
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("autocorrect", "off");
      input.setAttribute("aria-describedby", "studio-key-state studio-key-help");
    }
    return input;
  }

  /** Empty the key field, wherever its value could be held. */
  function clearKey() {
    key.value = "";
    const input = keyInput();
    if (input) input.value = "";
  }

  const form = () => ({ provider: String(company.value || ""), generationEndpoint: String(address.value || ""), model: String(model.value || "") });

  function paint() {
    const now = form();
    address.hidden = now.provider !== "custom-https";
    model.description = say("hsetup.modelHelp", { company: formCompany(now) });
    const state = keyState(settings || {}, now);
    fill(keyLine, ...state.words.map((words, index) => h("span", { text: index ? ` ${words}` : words })));
    keyHelp.textContent = state.state === "none" ? say("hsetup.newKeyHelpNone") : say("hsetup.newKeyHelp");
    remove.hidden = !state.removable;
    insecure.hidden = allowed;
    key.disabled = !allowed;
    if (!allowed) clearKey();
    const destination = formDestination(now);
    billed.textContent = destination ? say("hsetup.billed", { destination }) : "";
    saveLabel.textContent = anyway ? say("hsetup.saveAnyway") : say("hsetup.save");
    keyInput();
  }

  function show(next) {
    settings = next;
    const provider = providerId(next.provider);
    company.value = provider;
    model.value = String(next.model || "") || PROVIDERS[provider]?.defaultModel || "";
    address.value = String(next.generationEndpoint || "");
    clearKey();
    anyway = false;
    paint();
  }

  company.addEventListener("valuechange", () => {
    // Each company names its models its own way: the saved one for the saved company, else the
    // company's usual one (as the old Admin did).
    const provider = String(company.value || "");
    model.value = provider === providerId(settings?.provider) && settings?.model ? String(settings.model) : PROVIDERS[provider]?.defaultModel || "";
    anyway = false;
    paint();
  });
  address.addEventListener("valuechange", () => paint());
  key.addEventListener("valuechange", () => { if (anyway) { anyway = false; paint(); } key.error = ""; });
  requestAnimationFrame(() => keyInput());

  async function load() {
    status.textContent = "";
    try {
      show(await api.get("assistant/settings"));
      return true;
    } catch {
      status.textContent = say("hsetup.cantLoad");
      return false;
    }
  }

  async function send(request, { hadKey = false, done }) {
    busy = true;
    save.loading = true;
    serverSaid.hidden = true;
    status.textContent = say("hsetup.saving");
    try {
      // `retry: false`: if her session ran out, the request (and a key in it) is not held while
      // she signs in again, and is never sent a second time by itself.
      const reply = await api.call("PUT", "assistant/settings", { json: request, retry: false });
      clearKey();
      show(reply);
      status.textContent = done;
      onChanged?.();
      return true;
    } catch (error) {
      clearKey();
      if (error?.status === 401) {
        status.textContent = hadKey ? say("hsetup.signedOutKey") : say("hsetup.signedOut");
        api.onSignedOut?.().then(() => load().then(() => { status.textContent = hadKey ? say("hsetup.signedOutKey") : say("hsetup.signedOut"); }), () => {});
        return false;
      }
      const problem = settingsProblem(error, { hadKey });
      status.textContent = problem.words;
      if (problem.detail) { serverSaid.textContent = problem.detail; serverSaid.hidden = false; }
      if (problem.field === "address") address.error = problem.words;
      if (problem.reload) await load().then(() => { status.textContent = problem.words; });
      return false;
    } finally {
      busy = false;
      save.loading = false;
      // Whatever happened, nothing of the key is left in the page.
      clearKey();
    }
  }

  async function saveNow() {
    if (busy || !settings) return;
    address.error = "";
    key.error = "";
    const now = form();
    const wrong = settingsFormProblem(now);
    if (wrong) {
      status.textContent = wrong.words;
      if (wrong.field === "address") { address.error = wrong.words; address.querySelector("input")?.focus(); }
      return;
    }
    const typed = allowed ? String(keyInput()?.value ?? key.value ?? "") : "";
    if (typed.trim()) {
      const shape = keyShape(now.provider, typed);
      if (!shape.ok && (shape.problem === "too-long" || !anyway)) {
        // The field keeps what she pasted so she can look again; nothing has been sent.
        key.error = keyShapeWords(now.provider, shape, now);
        status.textContent = "";
        if (shape.problem !== "too-long") { anyway = true; paint(); }
        keyInput()?.focus();
        return;
      }
    }
    // Empty the field first: from here the key exists only in the request being sent.
    clearKey();
    anyway = false;
    paint();
    const request = settingsRequest({ ...now, etag: settings.etag, key: typed });
    const hadKey = request.credentialAction === "replace";
    await send(request, { hadKey, done: hadKey ? say("hsetup.keySaved") : say("hsetup.saved") });
  }

  async function removeKey() {
    if (busy || !settings) return;
    const environment = settings.credential?.source === "environment";
    const choice = await ask({
      heading: say("hsetup.removeHeading"), text: environment ? say("hsetup.removeTextServer") : say("hsetup.removeText"),
      choices: [{ label: say("hsetup.removeIt"), value: "remove", variant: "destructive" }, { label: say("hsetup.keepIt"), value: "keep", variant: "secondary" }],
      focus: 1,
    });
    if (choice !== "remove") { remove.querySelector("button")?.focus(); return; }
    clearKey();
    // The saved settings, not the form: removing the key changes nothing else.
    await send(settingsRequest({ provider: settings.provider, generationEndpoint: settings.generationEndpoint, model: settings.model, etag: settings.etag }, { remove: true }), { done: say("hsetup.keyRemoved") });
    remove.querySelector("button")?.focus();
  }

  async function checkNow() {
    if (busy) return;
    check.loading = true;
    serverSaid.hidden = true;
    status.textContent = say("hsetup.checking");
    const where = formCompany({ provider: providerId(settings?.provider), generationEndpoint: settings?.generationEndpoint });
    try {
      // Check it was pressed: that is the word the server asks for (nothing of the site goes).
      await api.call("POST", "assistant/check", { json: { confirmed: true } });
      status.textContent = say("hsetup.accepted", { company: where });
    } catch (error) {
      const problem = helperProblem(error, { company: where });
      status.textContent = error?.data?.code === "too-soon" ? say("hsetup.tooSoon") : problem.words;
      if (problem.details.length) { serverSaid.textContent = problem.details.join(" "); serverSaid.hidden = false; }
    } finally {
      check.loading = false;
    }
  }

  return {
    element,
    load,
    /** Something is typed in the key field (leaving asks once; the words never include it). */
    hasKeyTyped: () => Boolean(String(keyInput()?.value ?? key.value ?? "").trim()),
    clearKey,
    focusCompany: () => (company.querySelector("select, button") || company).focus?.(),
  };
}

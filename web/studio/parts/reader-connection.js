// The connection to the comments service, under For {helper} on How readers reach you: whether to use
// it, its address, the key (write-only), counting visits with it, and the robot check. The key is
// never returned by the server and never kept here: the field is emptied before the request is built
// and after every answer, so it is in one place on its way out (the request body). One Save, with the
// settings' version so a change made elsewhere is refused. Studio R10.
import { h } from "./dom.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { readerWords } from "./reader-rules.js";
import { keyStatus, setupProblem, settingsRequest } from "./reader-setup-rules.js";

/** `{ element, paint(settings) }`; `onSaved(settings, said)` runs after a good save, `onTrouble(error)` for a failure. */
export function createConnection({ api, onSaved, onConflict, onFail }) {
  const enabled = h("toggle-switch", { label: say("readers.connUse") });
  const endpoint = h("text-field", { label: say("readers.connAddress"), description: say("readers.connAddressHelp"), type: "url", maxlength: 2048, autocomplete: "off", inputmode: "url" });
  const keyLine = h("p", { class: "studio-help", id: "studio-reader-key-state", role: "status", "aria-live": "polite" });
  const key = h("text-field", { label: say("readers.connKeyReplace"), type: "password", name: "readers-key", autocomplete: "new-password", placeholder: say("readers.connKeyPlaceholder") });
  const analytics = h("toggle-switch", { label: say("readers.connCount") });
  const provider = h("select-field", { label: say("readers.connRobot"), options: [{ value: "off", label: say("readers.connRobotOff") }, { value: "turnstile", label: say("readers.connRobotTurnstile") }] });
  const siteKey = h("text-field", { label: say("readers.connSiteKey"), maxlength: 200, autocomplete: "off" });
  const scope = h("select-field", { label: say("readers.connScope"), options: [{ value: "session", label: say("readers.connScopeSession") }, { value: "every-comment", label: say("readers.connScopeEvery") }] });
  const note = h("p", { class: "studio-help", text: say("readers.connRobotNote") });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const problem = h("p", { class: "studio-comment-trouble", role: "alert", hidden: true });
  const remove = h("action-button", { variant: "secondary", hidden: true, onClick: () => removeKey() }, say("readers.connKeyRemove"));
  const save = h("action-button", { onClick: () => saveNow() }, say("readers.connSave"));
  const element = h("section", { class: "studio-helper-section", "aria-labelledby": "studio-reader-conn-h" },
    h("h3", { id: "studio-reader-conn-h", text: say("readers.detailsConnection") }),
    enabled, endpoint, keyLine, key, remove, analytics, provider, siteKey, scope, note, problem, h("cluster-layout", { gap: "0.5rem" }, save), status);

  let settings = null;
  let busy = false;

  const keyInput = () => key.querySelector("input");
  /** Empty the key field, wherever its value could be held. */
  function clearKey() {
    key.value = "";
    const input = keyInput();
    if (input) {
      input.value = "";
      input.setAttribute("spellcheck", "false");
      input.setAttribute("autocapitalize", "off");
      input.setAttribute("aria-describedby", "studio-reader-key-state");
    }
  }

  function paint(next) {
    settings = next;
    enabled.checked = next.enabled === true;
    endpoint.value = next.endpoint || "";
    analytics.checked = next.analytics !== false;
    // The server says "off" for no check; a site key and how often only matter with a check on.
    provider.value = next.captcha?.provider || "off";
    siteKey.value = next.captcha?.siteKey || "";
    scope.value = next.captcha?.scope || "session";
    siteKey.hidden = scope.hidden = provider.value === "off";
    keyLine.textContent = keyStatus(next.credential);
    remove.hidden = !next.credential?.privateConfigured;
    clearKey();
  }
  provider.addEventListener("valuechange", () => { siteKey.hidden = scope.hidden = !provider.value || provider.value === "off"; });

  const showProblem = (found) => {
    problem.textContent = readerWords(found.id);
    problem.hidden = false;
    const field = { endpoint, credential: key, siteKey }[found.field];
    field?.focus?.();
  };

  async function send(form, said) {
    if (busy || !settings) return;
    busy = true;
    problem.hidden = true;
    const found = setupProblem(form);
    if (found) { showProblem(found); busy = false; return; }
    const body = settingsRequest(settings, form);
    // The key is in the body now; the field is emptied before anything is sent.
    clearKey();
    try {
      const reply = await api.put("engagement/settings", body);
      paint({ ...settings, ...reply });
      status.textContent = said;
      onSaved?.({ ...settings, ...reply }, said);
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) { await onConflict?.(); return; }
      // G62: the server takes a key only over https (or from this computer, when it isn't deployed).
      if (error?.data?.code === "insecure") { problem.textContent = say("readers.connInsecure"); problem.hidden = false; return; }
      onFail?.(error);
    } finally {
      busy = false;
    }
  }

  const readForm = () => ({
    enabled: enabled.checked, comments: settings?.comments !== false, analytics: analytics.checked, endpoint: String(endpoint.value || ""),
    credential: String(key.value || keyInput()?.value || ""), captcha: { provider: String(provider.value || ""), scope: String(scope.value || ""), siteKey: String(siteKey.value || "") },
  });

  function saveNow() {
    const form = readForm();
    return send({ ...form, credentialAction: form.credential.trim() ? "replace" : "keep" }, say("readers.connSaved"));
  }

  async function removeKey() {
    const choice = await ask({
      heading: say("readers.connRemoveTitle"), text: say("readers.connRemoveText"),
      choices: [{ label: say("readers.eraseKeep"), value: "keep", variant: "secondary" }, { label: say("readers.connKeyRemove"), value: "remove", variant: "destructive" }],
    });
    if (choice !== "remove") return;
    return send({ ...readForm(), credential: "", credentialAction: "clear" }, say("readers.connSaved"));
  }

  return { element, paint, hasKeyTyped: () => Boolean(key.value || keyInput()?.value), clearKey };
}

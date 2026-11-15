// Setting the writing helper up (Studio R8): the companies, what the screen says about the key,
// and the one request that carries a key. Lifted from the old Admin's admin.js (`ASSISTANT_PROVIDERS`,
// ADR 0286). Pure: no page, no network.
//
// The key is write-only. Nothing here ever receives one from the server; `settingsRequest` is the
// only function a key passes through, on its way out, and the caller has emptied the field first.
import { say } from "./words.js";

/** The companies a site can use, with the model each starts with. */
export const PROVIDERS = Object.freeze({
  // `keysAt`: where an owner makes a key, named in Getting started's steps (never in a word id).
  anthropic: { label: "Anthropic Claude", company: "Anthropic", defaultModel: "claude-sonnet-5-5", destination: "https://api.anthropic.com", prefix: "sk-ant-", keysAt: "console.anthropic.com" },
  "open-ai": { label: "OpenAI", company: "OpenAI", defaultModel: "gpt-6-luna", destination: "https://api.openai.com", prefix: "sk-" },
  gemini: { label: "Google Gemini", company: "Google", defaultModel: "gemini-3.8-flash", destination: "https://generativelanguage.googleapis.com", prefix: "AIza" },
  xai: { label: "xAI Grok", company: "xAI", defaultModel: "grok-4.7", destination: "https://api.x.ai", prefix: "xai-" },
  "deep-seek": { label: "DeepSeek", company: "DeepSeek", defaultModel: "deepseek-flash", destination: "https://api.deepseek.com", prefix: "" },
  mistral: { label: "Mistral AI", company: "Mistral", defaultModel: "mistral-small-latest", destination: "https://api.mistral.ai", prefix: "" },
  "open-router": { label: "OpenRouter", company: "OpenRouter", defaultModel: "", destination: "https://openrouter.ai", prefix: "sk-or-" },
  "custom-https": { label: "Custom HTTPS", company: "", defaultModel: "", destination: "", prefix: "" },
});

/** The select's options, in order. */
export const providerOptions = () => Object.entries(PROVIDERS).map(([value, entry]) => ({ value, label: entry.label }));

/** A provider id as the settings name it (the status says "generic-https" for a custom address). */
export const providerId = (value) => (value === "generic-https" ? "custom-https" : PROVIDERS[value] ? value : "custom-https");

/** The host of a custom address, or "". Never its path, its query or anything before an @. */
export function addressHost(address) {
  try {
    return new URL(String(address || "").trim()).hostname;
  } catch {
    return "";
  }
}

/** The company's name for a form: the provider's, or a custom address's host. */
export function formCompany({ provider = "", generationEndpoint = "" } = {}) {
  return PROVIDERS[provider]?.company || addressHost(generationEndpoint) || "that address";
}

/** Where requests go, for the line under the form: an origin, never a path. */
export function formDestination({ provider = "", generationEndpoint = "" } = {}) {
  if (PROVIDERS[provider]?.destination) return PROVIDERS[provider].destination;
  try {
    const url = new URL(String(generationEndpoint || "").trim());
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * What the screen says about the key: only whether one is set and where from, never the key.
 * `settings` is `assistant/settings` (its `credential` summary); `form` the company and address
 * chosen in the form, which may differ from what is saved.
 * `{ state: "none" | "private" | "environment" | "mismatch" | "changed", words: [..], removable }`.
 */
export function keyState(settings = {}, form = null) {
  const credential = settings.credential && typeof settings.credential === "object" ? settings.credential : {};
  const saved = { provider: providerId(settings.provider), generationEndpoint: String(settings.generationEndpoint || "") };
  const chosen = form ? { provider: providerId(form.provider), generationEndpoint: String(form.generationEndpoint || "") } : saved;
  const removable = credential.privateConfigured === true;
  const company = formCompany(chosen);
  const target = (which) => (which.provider === "custom-https" ? `custom-https:${which.generationEndpoint.trim()}` : which.provider);
  if (removable && target(chosen) !== target(saved) && credential.source !== "environment") {
    return { state: "changed", words: [say("hsetup.keyChanged", { was: formCompany(saved), company })], removable };
  }
  if (credential.source === "environment") {
    const name = /^[A-Z][A-Z0-9_]{0,60}$/.test(String(credential.environmentName || "")) ? credential.environmentName : "the environment";
    return { state: "environment", words: [say("hsetup.keyServer", { name }), ...(removable ? [say("hsetup.keyServerAlso")] : [])], removable };
  }
  if (credential.targetMismatch === true) return { state: "mismatch", words: [say("hsetup.keyOther", { company })], removable };
  if (credential.source === "private") return { state: "private", words: [say("hsetup.keySet")], removable };
  return { state: "none", words: [say("hsetup.keyNone")], removable };
}

/** The longest a key may be, in bytes (the server's limit). */
export const KEY_MAX_BYTES = 16 * 1024;

/**
 * Whether what was pasted looks like that company's key: `{ ok }`, or `{ ok: false, problem:
 * "shape" | "too-long", prefix }`. A sign-in password pasted by a password manager doesn't start
 * the way a key does, so it is caught here before it is sent anywhere. Only a warning: Save it
 * anyway sends it.
 */
export function keyShape(provider, value) {
  const key = String(value ?? "").trim();
  if (!key) return { ok: true };
  if (new TextEncoder().encode(key).length > KEY_MAX_BYTES) return { ok: false, problem: "too-long", prefix: "" };
  const prefix = PROVIDERS[providerId(provider)]?.prefix || "";
  if (/\s/.test(key)) return { ok: false, problem: "shape", prefix };
  if (prefix && !key.startsWith(prefix)) return { ok: false, problem: "shape", prefix };
  // An OpenAI key isn't an Anthropic or OpenRouter one, though all three start with "sk-".
  if (providerId(provider) === "open-ai" && /^sk-(ant|or)-/.test(key)) return { ok: false, problem: "shape", prefix };
  return { ok: true };
}

/**
 * Whether a key may be typed on this page: over https, or on this same computer. Anywhere else a
 * key typed here could be read on the way (the server refuses it too, G62).
 */
export function keyFieldAllowed(location = {}) {
  if (location.protocol === "https:") return true;
  const host = String(location.hostname || "").replace(/^\[|\]$/g, "");
  return location.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "::1");
}

/**
 * The body of `PUT assistant/settings`. `form.key` is what was in the key field, which the caller
 * has already emptied; it is in the request only when there is one (`replace`), and an empty field
 * keeps the key that is set (`keep`, with no `credential` at all). `remove` clears it and never
 * carries a key.
 */
export function settingsRequest(form = {}, { remove = false } = {}) {
  const provider = providerId(form.provider);
  const key = remove ? "" : String(form.key ?? "").trim();
  const body = {
    provider,
    generationEndpoint: provider === "custom-https" ? String(form.generationEndpoint || "").trim() : "",
    model: String(form.model || "").trim(),
    etag: form.etag ?? null,
    credentialAction: remove ? "clear" : key ? "replace" : "keep",
  };
  if (body.credentialAction === "replace") body.credential = key;
  return body;
}

/** What is wrong with the form before anything is sent: `{ field, words }` or null. */
export function settingsFormProblem(form = {}) {
  const provider = String(form.provider || "");
  if (!PROVIDERS[provider]) return { field: "provider", words: say("hsetup.badCompany") };
  if (provider === "custom-https" && String(form.generationEndpoint || "").trim()) {
    let ok = false;
    try {
      const url = new URL(String(form.generationEndpoint).trim());
      ok = url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch { /* not an address */ }
    if (!ok) return { field: "address", words: say("hsetup.badAddress") };
  }
  if (String(form.generationEndpoint || "").length > 2048 || String(form.model || "").length > 200) return { field: "model", words: say("hsetup.tooLongSetting") };
  return null;
}

/**
 * Why the settings didn't save: `{ words, field, reload, detail }`. `hadKey` is whether a key was
 * in the request (it wasn't saved, and the field is already empty). The server's sentence goes to
 * `detail`; it never holds the key.
 */
export function settingsProblem(error = {}, { hadKey = false } = {}) {
  const status = Number(error?.status) || 0;
  const server = typeof error?.data?.error === "string" ? error.data.error : "";
  const out = (words, extra = {}) => ({ words, field: "", reload: false, detail: server, ...extra });
  if (status === 409) return out(hadKey ? say("hsetup.conflict") : say("hsetup.conflictPlain"), { reload: true });
  if (status === 422 && error?.data?.code === "insecure") return out(say("hsetup.insecureServer"), { field: "key" });
  if (status === 422 && /provider/i.test(server)) return out(say("hsetup.badCompany"), { field: "provider" });
  if (status === 422 && /endpoint must be/i.test(server)) return out(say("hsetup.badAddress"), { field: "address" });
  if (status === 422 && /too long/i.test(server)) return out(say("hsetup.tooLongSetting"), { field: "model" });
  if (status === 422 && /credential/i.test(server)) return out(say("hsetup.keyTooLong"), { field: "key" });
  if (status === 0 || !server) return out(say("hsetup.notSavedPlain"));
  return out(say("hsetup.notSaved", { why: server.slice(0, 160) }));
}

/** The words for a key that doesn't look right. */
export function keyShapeWords(provider, shape, form = {}) {
  if (shape.problem === "too-long") return say("hsetup.keyTooLong");
  return say("hsetup.shape", { company: formCompany({ provider, generationEndpoint: form.generationEndpoint }), prefix: shape.prefix || "letters and numbers, with no spaces" });
}

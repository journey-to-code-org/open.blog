// Setting the writing helper up (Studio R8). Ports the old Admin's admin-assistant-settings cases
// (a write-only replace, company defaults, the server's key winning, clearing never submits a key)
// in their Studio form, and adds: an empty field keeps the key and sends no `credential` at all,
// a pasted password is caught by its shape, and a key is never typed on a page sent over http.
import assert from "node:assert/strict";
import test from "node:test";

import {
  KEY_MAX_BYTES, PROVIDERS, addressHost, formCompany, formDestination, keyFieldAllowed, keyShape, keyShapeWords, keyState, providerId, providerOptions, settingsFormProblem, settingsProblem, settingsRequest,
} from "../../web/studio/parts/helper-settings-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";

const KEY = "sk-ant-api03-EXAMPLE-not-a-real-key";

test("each company has a friendly name and its own model to start with", () => {
  assert.deepEqual(Object.keys(PROVIDERS), ["anthropic", "open-ai", "gemini", "xai", "deep-seek", "mistral", "open-router", "custom-https"]);
  assert.equal(PROVIDERS.anthropic.label, "Anthropic Claude");
  assert.equal(PROVIDERS.anthropic.defaultModel, "claude-sonnet-5-5");
  assert.equal(PROVIDERS["open-ai"].defaultModel, "gpt-6-luna");
  assert.equal(PROVIDERS["custom-https"].defaultModel, "");
  assert.deepEqual(providerOptions()[0], { value: "anthropic", label: "Anthropic Claude" });
  assert.equal(providerId("generic-https"), "custom-https", "the status's name for a custom address");
  assert.equal(providerId("nobody"), "custom-https");
  assert.equal(formCompany({ provider: "gemini" }), "Google");
  assert.equal(formCompany({ provider: "custom-https", generationEndpoint: "https://user:pw@helper.example/v1?key=q" }), "helper.example");
  assert.equal(addressHost("not an address"), "");
  assert.equal(formDestination({ provider: "anthropic" }), "https://api.anthropic.com");
  assert.equal(formDestination({ provider: "custom-https", generationEndpoint: "https://helper.example:8443/v1/generate?key=q" }), "https://helper.example:8443", "an origin, never a path or a query");
  assert.equal(formDestination({ provider: "custom-https", generationEndpoint: "http://plain.example/" }), "");
});

test("a typed key is in the request once, and an empty field keeps the one that's set", () => {
  const form = { provider: "anthropic", model: " claude-test ", generationEndpoint: "https://ignored.example", etag: "e1" };
  assert.deepEqual(settingsRequest({ ...form, key: `  ${KEY}\n` }), { provider: "anthropic", generationEndpoint: "", model: "claude-test", etag: "e1", credentialAction: "replace", credential: KEY });
  const keep = settingsRequest({ ...form, key: "   " });
  assert.equal(keep.credentialAction, "keep");
  assert.equal("credential" in keep, false, "no credential key at all");
  assert.equal("credential" in settingsRequest(form), false);
  assert.equal(JSON.stringify(settingsRequest(form)).includes("credential\":"), false);
  // A custom address keeps its address; a named company never sends one.
  assert.equal(settingsRequest({ provider: "custom-https", generationEndpoint: " https://helper.example/v1 ", model: "", etag: "e" }).generationEndpoint, "https://helper.example/v1");
});

test("clearing never submits a key, even with one typed", () => {
  const clear = settingsRequest({ provider: "anthropic", model: "m", etag: "e", key: KEY }, { remove: true });
  assert.equal(clear.credentialAction, "clear");
  assert.equal("credential" in clear, false);
  assert.equal(JSON.stringify(clear).includes(KEY), false);
});

test("the key's state says only whether one is set and where from", () => {
  configureWords();
  const settings = (credential, more = {}) => ({ provider: "anthropic", generationEndpoint: "", model: "m", etag: "e", credential, ...more });
  assert.deepEqual(keyState(settings({ configured: false, source: "none", privateConfigured: false })), { state: "none", words: ["No key is set."], removable: false });
  assert.deepEqual(keyState(settings({ configured: true, source: "private", privateConfigured: true })), { state: "private", words: ["A key is set. It's kept on the computer that runs your blog and never shown."], removable: true });
  // The server's key wins and is never read back; a saved one beside it can still be removed.
  assert.deepEqual(keyState(settings({ configured: true, source: "environment", privateConfigured: false, environmentOverride: true, environmentName: "ANTHROPIC_API_KEY" })), {
    state: "environment", words: ["A key is set by the server (ANTHROPIC_API_KEY). It's used instead of any key saved here."], removable: false,
  });
  const both = keyState(settings({ configured: true, source: "environment", privateConfigured: true, environmentName: "ANTHROPIC_API_KEY" }));
  assert.deepEqual(both.words, ["A key is set by the server (ANTHROPIC_API_KEY). It's used instead of any key saved here.", "A saved key is also kept."]);
  assert.equal(both.removable, true);
  assert.match(keyState(settings({ source: "environment", environmentName: "<script>" })).words[0], /by the server \(the environment\)/, "a name that isn't a variable's is not shown");
  assert.deepEqual(keyState(settings({ configured: false, source: "none", privateConfigured: true, targetMismatch: true })).words, ["The saved key is for another company or address, so it isn't used. Paste a key for Anthropic."]);
  // The company changed in the form, not saved yet.
  const changed = keyState(settings({ configured: true, source: "private", privateConfigured: true }), { provider: "open-ai", generationEndpoint: "" });
  assert.deepEqual(changed, { state: "changed", words: ["The saved key is for Anthropic. After you save, paste a key for OpenAI."], removable: true });
  const custom = keyState(settings({ configured: true, source: "private", privateConfigured: true }, { provider: "custom-https", generationEndpoint: "https://a.example/x" }), { provider: "custom-https", generationEndpoint: "https://b.example/x" });
  assert.equal(custom.words[0], "The saved key is for a.example. After you save, paste a key for b.example.");
  // Nothing in any state can carry a key: the summary never has one.
  for (const state of [keyState({}), keyState(settings({ source: "private", privateConfigured: true }))]) assert.equal(JSON.stringify(state).includes("sk-"), false);
});

test("a key is checked by its shape before it goes anywhere", () => {
  configureWords();
  assert.deepEqual(keyShape("anthropic", KEY), { ok: true });
  assert.deepEqual(keyShape("anthropic", ""), { ok: true }, "an empty field is no key");
  // A sign-in password a password manager offered.
  assert.deepEqual(keyShape("anthropic", "correct horse battery"), { ok: false, problem: "shape", prefix: "sk-ant-" });
  assert.deepEqual(keyShape("anthropic", "Tr0ub4dor&3"), { ok: false, problem: "shape", prefix: "sk-ant-" });
  assert.equal(keyShapeWords("anthropic", keyShape("anthropic", "Tr0ub4dor&3")), "That doesn't look like a key from Anthropic (they start with sk-ant-). Check you pasted the key, not a password.");
  assert.equal(keyShape("open-ai", "sk-proj-abc").ok, true);
  assert.equal(keyShape("open-ai", KEY).ok, false, "an Anthropic key pasted for OpenAI");
  assert.equal(keyShape("open-router", "sk-or-v1-abc").ok, true);
  assert.equal(keyShape("xai", "xai-abc").ok, true);
  assert.equal(keyShape("gemini", "AIzaSyExample").ok, true);
  assert.equal(keyShape("gemini", "sk-abc").ok, false);
  assert.equal(keyShape("mistral", "anything-goes").ok, true);
  assert.equal(keyShape("custom-https", "token with a space").ok, false, "a key has no spaces");
  const long = keyShape("mistral", "k".repeat(KEY_MAX_BYTES + 1));
  assert.deepEqual(long, { ok: false, problem: "too-long", prefix: "" });
  assert.equal(keyShapeWords("mistral", long), "That's too long to be a key.");
  // The words never repeat what was pasted.
  assert.equal(keyShapeWords("anthropic", keyShape("anthropic", "hunter2-secret")).includes("hunter2"), false);
});

test("a key is typed only on a page sent privately", () => {
  assert.equal(keyFieldAllowed({ protocol: "https:", hostname: "blog.example" }), true);
  assert.equal(keyFieldAllowed({ protocol: "http:", hostname: "example.com" }), false);
  assert.equal(keyFieldAllowed({ protocol: "http:", hostname: "192.168.1.20" }), false);
  assert.equal(keyFieldAllowed({ protocol: "http:", hostname: "localhost.example.com" }), false);
  for (const hostname of ["localhost", "127.0.0.1", "[::1]", "::1"]) assert.equal(keyFieldAllowed({ protocol: "http:", hostname }), true, hostname);
  assert.equal(keyFieldAllowed({}), false);
  assert.equal(keyFieldAllowed({ protocol: "file:", hostname: "" }), false);
});

test("the form is checked before anything is sent", () => {
  configureWords();
  assert.equal(settingsFormProblem({ provider: "anthropic", model: "m" }), null);
  assert.equal(settingsFormProblem({ provider: "nobody" }).words, "Choose a company from the list.");
  assert.equal(settingsFormProblem({ provider: "custom-https", generationEndpoint: "https://helper.example/v1" }), null);
  for (const address of ["http://helper.example/v1", "helper.example", "https://user:pw@helper.example/"]) {
    assert.deepEqual(settingsFormProblem({ provider: "custom-https", generationEndpoint: address }), { field: "address", words: "The address has to start with https:// and have no name or password in it." }, address);
  }
  assert.equal(settingsFormProblem({ provider: "anthropic", model: "m".repeat(201) }).field, "model");
});

test("a save that failed says what to do, and never holds the key", () => {
  configureWords();
  assert.deepEqual(settingsProblem({ status: 409, data: { error: "Assistant settings changed on disk; reload before saving" } }, { hadKey: true }), {
    words: "These settings were changed somewhere else. They're shown again now; the key you typed wasn't saved. Paste it again.", field: "", reload: true, detail: "Assistant settings changed on disk; reload before saving",
  });
  assert.equal(settingsProblem({ status: 409, data: {} }).words, "These settings were changed somewhere else. They're shown again now; make your change again.");
  assert.equal(settingsProblem({ status: 422, data: { code: "insecure", error: "A key can't be sent over plain http." } }).field, "key");
  assert.match(settingsProblem({ status: 422, data: { code: "insecure", error: "x" } }).words, /didn't reach it over https\. It wasn't saved/);
  assert.equal(settingsProblem({ status: 422, data: { error: "Assistant provider is not supported" } }).words, "Choose a company from the list.");
  assert.equal(settingsProblem({ status: 422, data: { error: "Assistant endpoint must be an HTTPS URL without embedded credentials" } }).field, "address");
  assert.equal(settingsProblem({ status: 422, data: { error: "Enter a credential no larger than 16 KiB" } }).words, "That's too long to be a key.");
  assert.equal(settingsProblem({ status: 500, data: { error: "cannot write openblog.json: read-only" } }).words, "That wasn't saved. Cannot write openblog.json: read-only");
  assert.equal(settingsProblem({ status: 0 }, { hadKey: true }).words, "That wasn't saved, and the key you typed wasn't kept. Try again.");
});

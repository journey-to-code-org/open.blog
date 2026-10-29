// The provider capability contract on the hosted side (epic #381, story #389, ADRs 0720 to 0722):
// an adapter is registered only under a manifest that reads and does every announcement need, and
// anything unknown or narrowed fails closed. Fakes only; no provider is called.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { admittedManifest, ANNOUNCEMENT_NEEDS, CAPABILITIES, checkRequest, MANIFEST_VERSION, ManifestError, MANIFESTS, parseCapabilities, parseManifest, policyVersionKey } from "../../netlify/lib/social-capabilities.mjs";
import { providers, scripted } from "./social-publish-fakes.mjs";

const withChange = (provider, change) => {
  const copy = structuredClone({ ...MANIFESTS[provider], capabilities: { ...MANIFESTS[provider].capabilities }, constraints: { ...MANIFESTS[provider].constraints } });
  change(copy);
  return copy;
};

test("each configured provider's adapter carries the manifest it was admitted under", () => {
  const adapters = socialAdapters({ providers: providers() });
  assert.deepEqual(Object.keys(adapters).sort(), ["facebook", "linkedin"]);
  for (const provider of ["linkedin", "facebook"]) {
    assert.deepEqual(adapters[provider].manifest, MANIFESTS[provider]);
    assert.ok(Object.isFrozen(adapters[provider].manifest));
    assert.ok(Object.isFrozen(adapters[provider]));
    assert.deepEqual(checkRequest(adapters[provider].manifest, { capabilities: ANNOUNCEMENT_NEEDS }), []);
  }
  assert.equal(adapters.linkedin.reconcile, undefined, "the wrapper adds no lookup the adapter lacks");
});

test("a manifest that is missing, broken, unknown or narrowed gets no adapter", () => {
  const cases = {
    "no manifest": {},
    "a manifest of another provider": { linkedin: MANIFESTS.facebook },
    "an unknown capability": { linkedin: withChange("linkedin", (m) => (m.capabilities.carousel = "adapter")) },
    "an unknown support level": { linkedin: withChange("linkedin", (m) => (m.capabilities.link = "maybe")) },
    "a later manifest format": { linkedin: withChange("linkedin", (m) => (m.manifestVersion = 2)) },
    "links became manual": { linkedin: withChange("linkedin", (m) => (m.capabilities.link = "manual")) },
    "scheduling became unsupported": { linkedin: withChange("linkedin", (m) => (m.capabilities.schedule = "unsupported")) },
    "not an object": { linkedin: "adapter" },
  };
  for (const [name, manifests] of Object.entries(cases)) {
    const adapters = socialAdapters({ providers: providers(), manifests: { facebook: MANIFESTS.facebook, ...manifests } });
    assert.deepEqual(Object.keys(adapters), ["facebook"], name);
  }
  assert.deepEqual(Object.keys(socialAdapters({ providers: providers(), manifests: null })), []);
  assert.equal(admittedManifest("constructor"), null);
  assert.equal(admittedManifest("__proto__", { __proto__: MANIFESTS.linkedin }), null);
});

test("a refused manifest makes no request and is off by default with no provider configured", async () => {
  const fake = scripted({ status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
  const adapters = socialAdapters({ providers: providers(), fetchImpl: fake.fetchImpl, manifests: {} });
  assert.deepEqual(Object.keys(adapters), []);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(Object.keys(socialAdapters()), [], "no provider, no adapter, whatever the manifests");
});

test("an unknown requested capability refuses the whole request", () => {
  for (const names of [["link", "poll"], ["Link"], "link", [1]]) {
    assert.throws(() => parseCapabilities(names), (error) => error instanceof ManifestError && error.code === "unknown-capability");
    assert.throws(() => checkRequest(MANIFESTS.linkedin, { capabilities: names }), ManifestError);
  }
  assert.deepEqual(parseCapabilities(["text", "link", "text"]), ["link", "text"]);
});

test("a refusal never repeats the value it refused", () => {
  const error = (() => {
    try {
      parseManifest(withChange("facebook", (m) => (m.provider = "<script>x</script>")));
    } catch (caught) {
      return caught;
    }
  })();
  assert.equal(error.code, "unknown-provider");
  assert.ok(!error.message.includes("script"));
});

// The shared contract fixture, which crates/openblog-core/tests/provider_manifest.rs runs too.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/provider-manifests.json", import.meta.url), "utf8"));

const changed = (base, changes) => {
  const value = structuredClone(base);
  for (const change of changes) {
    const path = change.set ?? change.delete;
    const last = path.at(-1);
    const target = path.slice(0, -1).reduce((node, key) => node[key], value);
    if (change.set) target[last] = change.value;
    else delete target[last];
  }
  return value;
};

test("the shipped social manifests are the fixture's exactly, and every shipped manifest reads", () => {
  assert.equal(fixture.manifestVersion, MANIFEST_VERSION);
  assert.deepEqual(fixture.capabilities, CAPABILITIES);
  assert.deepEqual(fixture.announcementNeeds, ANNOUNCEMENT_NEEDS);
  for (const provider of ["linkedin", "facebook"]) assert.deepEqual(MANIFESTS[provider], fixture.manifests[provider], provider);
  for (const [provider, manifest] of Object.entries(fixture.manifests)) assert.deepEqual(parseManifest(manifest), manifest, provider);
});

test("every refused manifest fails closed with the fixture's code", () => {
  for (const entry of fixture.refused) {
    assert.throws(
      () => parseManifest(changed(fixture.manifests[entry.base], entry.changes)),
      (error) => error instanceof ManifestError && error.code === entry.code,
      entry.name,
    );
  }
  for (const value of [null, [], "manifest", 1]) assert.throws(() => parseManifest(value), (error) => error.code === "manifest-malformed");
});

test("every request is checked against its destination as the fixture says", () => {
  for (const entry of fixture.requests) {
    const manifest = parseManifest(fixture.manifests[entry.provider]);
    const problems = checkRequest(manifest, entry.request);
    assert.deepEqual(problems.map((problem) => problem.code), entry.codes, `${entry.provider} ${JSON.stringify(entry.request)}`);
    for (const problem of problems) assert.ok(problem.message.includes(manifest.label));
  }
  for (const names of fixture.unknownRequests) assert.throws(() => parseCapabilities(names), (error) => error.code === "unknown-capability");
});

test("policy versions are dates with an optional revision", () => {
  assert.deepEqual(policyVersionKey("2026-10-29"), ["2026-10-29", 0]);
  assert.deepEqual(policyVersionKey("2026-10-29.2"), ["2026-10-29", 2]);
  for (const bad of ["2026-13-01", "2026-10-29.0", "2026-10-29.", "26-10-29", "2026-10-29.100", "latest", null]) assert.equal(policyVersionKey(bad), null, String(bad));
});

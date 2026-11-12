// The provider adapters this deployment delivers through (epic #353, ADRs 0316, 0319 and 0326). The
// worker (social-worker.mjs) calls a provider only through the interface in social-delivery.mjs and
// asks this module which providers it has an adapter for. An adapter is registered only for a
// provider that socialProviders(env) reports as configured (client id, secret and a valid API
// version), so delivery to a provider is off until the deployer sets it up. A provider that is not
// here is not guessed at: its announcements wait in the queue (ADR 0317).
//
// An adapter is also registered only under a provider manifest that reads and says the adapter
// does everything an announcement needs (social-capabilities.mjs, ADR 0326); the manifest travels
// on the adapter as `manifest`. A manifest that is missing, unknown or narrowed fails closed: the
// provider gets no adapter.
//
// `providers` is socialProviders(env): its secrets are not enumerable and never reach an adapter's
// output or a log. `fetchImpl`, `now` and `manifests` are injected so the adapters are tested
// against fakes.

import { ADAPTER_FACTORIES } from "./social-publish.mjs";
import { admittedManifest, MANIFESTS } from "./social-capabilities.mjs";
import { PROVIDERS } from "./social-providers.mjs";

export function socialAdapters({ providers = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), manifests = MANIFESTS } = {}) {
  const adapters = Object.create(null);
  for (const [provider, factory] of Object.entries(ADAPTER_FACTORIES)) {
    const settings = Object.hasOwn(providers, provider) ? providers[provider] : null;
    if (!settings || settings.provider !== provider || typeof settings.apiBase !== "string" || typeof settings.version !== "string") continue;
    const manifest = admittedManifest(provider, manifests);
    if (!manifest) continue;
    const adapter = factory(settings, { fetchImpl, now });
    if (adapter?.provider !== provider) continue;
    adapters[provider] = Object.freeze({ ...adapter, manifest });
  }
  return Object.freeze(adapters);
}

/** Providers this release knows but `adapters` cannot deliver to: the claim leaves their announcements waiting. */
export function waitingProviders(adapters = {}) {
  return PROVIDERS.filter((provider) => !(adapters && Object.hasOwn(adapters, provider)));
}

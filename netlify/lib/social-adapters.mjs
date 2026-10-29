// The provider adapters this deployment delivers through (epic #353, ADR 0314). The worker
// (social-worker.mjs) calls a provider only through the interface in social-delivery.mjs and asks
// this module which providers it has an adapter for. A provider that is not here is not guessed
// at: its announcements wait in the queue until an adapter exists (story SP5 registers the
// LinkedIn Posts API and Facebook Pages feed adapters here).
//
// `fetchImpl` and `providers` (the configured provider settings, never secrets in a log) are what an
// adapter factory receives, so adapters are tested against fakes with no network.

export function socialAdapters({ providers = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), env = {} } = {}) {
  void providers;
  void fetchImpl;
  void now;
  void env;
  return {};
}

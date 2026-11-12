// The daily retention sweep of quote requests (epic #474, story #486; ADR 0384). Netlify runs it on
// the schedule below. It does nothing unless quote requests are enabled AND a retention period is
// set, by OPENBLOG_QUOTE_RETENTION_DAYS or by the owner in Admin (ADR 0387): then it erases archived
// requests older than that many days (whole requests, verified), and reports counts only.

import { quoteSettings } from "../lib/quote-intake.mjs";
import { createStore } from "../lib/quote-store.mjs";
import { retentionSetting, retentionSweep } from "../lib/quote-admin.mjs";

export function createSweep({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  return async () => {
    const settings = quoteSettings(env);
    if (!settings.enabled) return { enabled: false, erased: 0 };
    try {
      const store = createStore({ settings, fetchImpl, now });
      const { days } = await retentionSetting({ store, env });
      if (!days) return { enabled: false, erased: 0 };
      return await retentionSweep({ store, settings, days, now });
    } catch (error) {
      return { enabled: true, erased: 0, error: error?.code || "failed" };
    }
  };
}

const sweep = createSweep();
export default async () => new Response(JSON.stringify(await sweep()), { status: 200, headers: { "content-type": "application/json" } });
export const config = { schedule: "@daily" };

// Greeting cards (ADR 0411): the hourly run that sends every card whose time has come. Netlify runs
// it on the schedule below. It does nothing unless greeting cards are switched on and complete, and
// it reports counts only, never a name, an address or a message.

import { brevoTransport, createGreetingStore, greetingSettings } from "../lib/greeting-store.mjs";
import { sendDue } from "../lib/greeting-send.mjs";

export function createRun({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), transport = null } = {}) {
  return async () => {
    const settings = greetingSettings(env);
    if (!settings.enabled) return { enabled: false, sent: 0 };
    try {
      const store = createGreetingStore({ settings, fetchImpl, now });
      const send = transport || brevoTransport({ apiKey: settings.apiKey, fetchImpl });
      return { enabled: true, ...(await sendDue({ settings, store, transport: send, now })) };
    } catch (error) {
      return { enabled: true, sent: 0, error: error?.code || "failed" };
    }
  };
}

const run = createRun();
export default async () => new Response(JSON.stringify(await run()), { status: 200, headers: { "content-type": "application/json" } });
export const config = { schedule: "@hourly" };

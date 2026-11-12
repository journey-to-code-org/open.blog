// Greeting cards (ADR 0411): sending what is due. The hourly function calls `sendDue`; it takes each
// due card (so two runs never send one card twice), renders it for its person, hands it to the
// email service, and then either marks it sent, moves a yearly card to next year, or keeps it for
// another try. A card that fails three times stops and waits for the owner, with a fixed reason.

import { nextSendAt, renderCard } from "./greeting-card.mjs";

export const MAX_ATTEMPTS = 3;

const dayIn = (at, zone) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

export async function sendDue({ settings, store, transport, now = () => Date.now() }) {
  const report = { sent: 0, failed: 0, retrying: 0, skipped: 0 };
  for (const due of await store.due()) {
    const card = await store.claim(due);
    if (!card) {
      report.skipped += 1;
      continue;
    }
    const contact = await store.contact(card.contact_id);
    if (!contact) {
      await store.updateCard(card.id, { status: "failed", error_code: "no-contact" });
      report.failed += 1;
      continue;
    }
    const zone = card.time_zone || settings.zone;
    const mail = renderCard(
      { design: card.design, subject: card.subject, message: card.message, signOff: card.sign_off },
      { contact, from: settings.from, siteUrl: settings.siteUrl, siteName: settings.siteName, sendDay: dayIn(card.next_send_at, zone) },
    );
    const result = await transport(mail);
    const at = new Date(now()).toISOString();
    if (result.ok) {
      if (card.yearly) {
        const next = nextSendAt({ sendOn: card.send_on, hour: card.send_hour, zone, yearly: true, after: Date.parse(card.next_send_at) }, now());
        await store.updateCard(card.id, { status: "scheduled", next_send_at: next.toISOString(), last_sent_at: at, attempts: 0, error_code: null });
      } else {
        await store.updateCard(card.id, { status: "sent", last_sent_at: at, attempts: 0, error_code: null });
      }
      report.sent += 1;
      continue;
    }
    const attempts = (Number(card.attempts) || 0) + 1;
    // A refused key or a rejected message won't fix itself in an hour; anything else is tried again.
    const final = attempts >= MAX_ATTEMPTS || result.code === "refused-key" || result.code === "rejected";
    await store.updateCard(card.id, { status: final ? "failed" : "scheduled", attempts, error_code: result.code });
    if (final) report.failed += 1;
    else report.retrying += 1;
  }
  return report;
}

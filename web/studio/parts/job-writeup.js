// "Write it up for me" (Studio R4, amends ADR 0304): in Write, for a job post. A sheet says what
// goes and where before anything leaves (her words in this job, its service and town; never the
// photos or the voice note), with "Make it sound like me" when she has a voice guide. What comes back
// is untrusted: normalizeDraft bounds it, and it is shown as text in her boxes, never saved by itself.
import { h } from "./dom.js";
import { normalizeDraft } from "./capture-assistant-rules.js";
import { companyName, writeUpDisclosure, writeUpTrouble } from "./job-words.js";

/** Whether writing up is set up, and the voice guide that could go: `{ ready, status, guide }`. */
export async function writeUpSetup(api) {
  let status = null;
  try {
    status = await api.get("assistant/status");
  } catch {
    return { ready: false, status: null, guide: null };
  }
  if (!status?.configured) return { ready: false, status, guide: null };
  let guide = null;
  try {
    const catalog = await api.get("assistant/context");
    const usable = (catalog?.voiceGuides || []).filter((doc) => doc?.contextType === "voice" && doc.exists === true && doc.valid === true && typeof doc.id === "string");
    const picked = usable.find((doc) => doc.visibility === "private") || usable[0];
    if (picked) guide = { id: picked.id };
  } catch {
    // It writes without a guide; it just doesn't sound like her yet.
  }
  return { ready: true, status, guide };
}

/** About how many words: "about 240". */
export const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;

/**
 * Ask first, in `sheet`, then write it up. Resolves `{ draft }`, `{ error }`, or null for Not now.
 * `request` is `{ notes, photoAlts, trade, service, town }`.
 */
export function askToWriteUp({ api, sheet, setup, request, opener }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const like = setup.guide ? h("toggle-switch", { label: "Make it sound like me", checked: true }) : null;
    const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const go = h("action-button", {
      onClick: async () => {
        go.loading = true;
        status.textContent = "Writing it up…";
        try {
          const reply = await api.call("POST", "assistant/job-draft", { json: { ...request, contextIds: like?.checked && setup.guide ? [setup.guide.id] : [] } });
          const draft = normalizeDraft(reply?.draft);
          finish(draft ? { draft } : { error: writeUpTrouble({}) });
        } catch (error) {
          finish({ error: writeUpTrouble(error) });
        }
        sheet.close();
      },
    }, "Write it up");
    const later = h("action-button", { variant: "secondary", onClick: () => { finish(null); sheet.close(); } }, "Not now");
    sheet.show({
      heading: "Write it up for me",
      opener,
      children: [
        h("p", { text: writeUpDisclosure({ words: wordCount(request.notes), destination: companyName({ provider: setup.status?.providerType, destination: setup.status?.destination }) }) }),
        like, status, h("div", { class: "studio-sheet-actions" }, go, later),
      ],
      focus: () => go.querySelector("button")?.focus(),
      onClose: () => finish(null),
    });
  });
}

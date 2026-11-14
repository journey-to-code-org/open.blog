// "Turn your voice note into words" (Studio R4), for New job and for a job in Write: a sheet that
// says where the recording goes before anything leaves, then keeps the note on her blog (the same id
// keeps the first copy) and asks for the words. The words come back untrusted: the caller adds them
// with appendTranscript, which makes them plain.
import { h } from "./dom.js";
import { transcribeDisclosure, transcribeTrouble } from "./job-words.js";

/** Whether turning a note into words is set up: `{ available, disclosure }`. Anything odd is "not here". */
export async function transcribeSetup(api) {
  try {
    const disclosure = await api.get("assistant/transcribe");
    return disclosure?.available ? { available: true, disclosure } : { available: false, disclosure };
  } catch {
    return { available: false, disclosure: null };
  }
}

/**
 * Ask first, in `sheet` (parts/sheet.js), then turn it into words. `blob` is the note when it is
 * still only on this phone. Resolves `{ transcript, truncated }`, `{ error: words }` or null when she
 * said Not now.
 */
export function askToTranscribe({ api, sheet, captureId, blob = null, disclosure, opener }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const go = h("action-button", {
      onClick: async () => {
        go.loading = true;
        status.textContent = "Turning it into words…";
        try {
          if (blob) await api.call("POST", `capture-audio?capture=${captureId}`, { body: blob, headers: { "Content-Type": "application/octet-stream" } });
          const reply = await api.call("POST", "assistant/transcribe", { json: { captureId, confirmed: true } });
          finish({ transcript: String(reply?.transcript || ""), truncated: reply?.truncated === true });
          sheet.close();
        } catch (error) {
          go.loading = false;
          const words = transcribeTrouble(error);
          finish({ error: words, hide: !words });
          sheet.close();
        }
      },
    }, "Turn it into words");
    const later = h("action-button", { variant: "secondary", onClick: () => { finish(null); sheet.close(); } }, "Not now");
    sheet.show({
      heading: "Turn your voice note into words",
      opener,
      children: [h("p", { text: transcribeDisclosure(disclosure || {}) }), status, h("div", { class: "studio-sheet-actions" }, go, later)],
      focus: () => go.querySelector("button")?.focus(),
      onClose: () => finish(null),
    });
  });
}

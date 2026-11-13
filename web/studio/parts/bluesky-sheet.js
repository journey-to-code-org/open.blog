// Bluesky's Connect and Reconnect sheet (Studio R2): her Bluesky name and an app password. The
// password field is emptied before anything is checked or sent, every time, and the password is
// never put in a status, a detail or the leave question. docs/specs/studio/r2/ux.md.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { detailsBox, providerLines } from "./account-details.js";
import * as R from "./social-rules.js";

/** The sheet's opener, sharing the screen's sheet and helpers (parts/account-sheets.js). */
export function blueskySheet({ api, sheet, ctx, say, statusBox, headingOf, openChoose }) {
  return async function openBluesky(account = null, { opener = document.activeElement } = {}) {
    await use("action-button", "alert-banner", "side-sheet", "text-field");
    const start = account ? String(account.displayName || "").replace(/^@/, "") : "";
    const title = account ? `Reconnect ${account.displayName}` : "Connect Bluesky";
    const heading = headingOf(title);
    const status = statusBox();
    const nameField = h("text-field", { label: "Your Bluesky name", autocomplete: "username", required: true, value: start, placeholder: "grammi.bsky.social",
      onValuechange: () => { if (nameField.value) nameField.error = ""; } });
    const secret = h("text-field", { label: "App password", type: "password", autocomplete: "off", required: true, description: R.appPasswordHelp,
      onValuechange: () => { if (secret.value) secret.error = ""; } });
    const input = (field) => field.querySelector("input");
    requestAnimationFrame(() => {
      for (const field of [nameField, secret]) {
        input(field)?.setAttribute("autocapitalize", "none");
        input(field)?.setAttribute("spellcheck", "false");
      }
    });
    // A submit button, so Enter in either field sends; the form's own submit runs the check.
    const send = h("action-button", { size: "lg", type: "submit" }, account ? `Reconnect ${account.displayName}` : "Connect Bluesky");
    const typed = () => String(nameField.value || "").trim() !== start && String(nameField.value || "").trim() !== "";

    async function submit() {
      if (send.loading) return false;
      const identifier = String(nameField.value || "").trim();
      const appPassword = String(secret.value || "").trim();
      // Emptied first, every time: before the check, before the request, whatever happens next.
      secret.value = "";
      const field = (which) => (which === "name" ? nameField : secret);
      const problem = R.blueskyCheck(identifier, appPassword);
      if (problem) {
        field(problem.field).error = problem.text;
        requestAnimationFrame(() => input(field(problem.field))?.focus());
        return false;
      }
      send.loading = true;
      say(status, "");
      try {
        const reply = account
          ? await api.post(`social/accounts/${account.id}/reconnect`, { identifier, appPassword })
          : await api.post("social/connections", { provider: "bluesky", identifier, appPassword });
        sheet.guard({ dirty: () => false });
        if (account) {
          sheet.close();
          ctx.done({ kind: "reconnected", accountId: account.id });
        } else {
          await openChoose(reply.connection, { opener });
        }
        return true;
      } catch (error) {
        secret.value = "";
        if (error.status === 401) throw error;
        const code = error.data?.code;
        if (account && (error.status === 404 || code === "disconnected")) {
          sheet.guard({ dirty: () => false });
          sheet.close();
          ctx.done({ kind: "gone", account });
          return true;
        }
        if (code === "identity-mismatch") {
          say(status, R.mismatchWords("bluesky", { name: account?.displayName }));
          return false;
        }
        const placed = R.blueskyFieldError(error);
        if (placed?.field) {
          field(placed.field).error = placed.text;
          requestAnimationFrame(() => input(field(placed.field))?.focus());
        } else {
          say(status, placed?.text || R.actionTrouble(error, "bluesky"), "danger");
          heading.focus();
        }
        return false;
      } finally {
        send.loading = false;
      }
    }

    sheet.show({
      heading: title,
      opener,
      children: [status,
        h("form", { class: "studio-field-form", noValidate: true, onSubmit: (event) => { event.preventDefault(); submit(); } }, nameField, secret, send),
        detailsBox([...providerLines(ctx.providerOf("bluesky")), account ? `account ${account.id} ${account.externalId}` : ""])],
      dirty: typed,
      save: submit,
      question: account
        ? { heading: `Reconnect ${account.displayName}?`, text: "You typed your Bluesky name and didn't reconnect.", save: `Reconnect ${account.displayName}`, leave: "Leave without reconnecting" }
        : { heading: "Connect Bluesky?", text: "You typed your Bluesky name and didn't connect.", save: "Connect Bluesky", leave: "Leave without connecting" },
      focus: () => input(account ? secret : nameField)?.focus(),
      onClose: () => { secret.value = ""; },
    });
  };
}

// Home's two lines about Your writing voice (Studio R9). Writing kept only on this phone (a rough
// draft in progress, unsaved changes to a polished copy) is named where she sees it, with Open.
// And, once, an invitation to write a first piece: only when the writing helper is set up, she has
// no pieces, none is in progress and she hasn't said No thanks (the server remembers, G64).
// Home never shows a failure here.
import { fill, h, toast } from "./dom.js";
import { say } from "./words.js";
import { createDidLine } from "./did-line.js";
import { invitationVisible, pieceHash, voiceHash } from "./voice-rules.js";
import { voiceCopiesOnPhone } from "./voice-copies.js";

export function homeVoice({ api, meta, storage = () => globalThis.localStorage, onboardingOwnsIt = () => false }) {
  const kept = h("div", { class: "studio-home-voice-kept" });
  const invite = h("div", { class: "studio-home-voice-invite" });
  const said = createDidLine();
  const element = h("div", { class: "studio-home-voice" }, kept, invite, said.element);

  function paintKept() {
    const copies = voiceCopiesOnPhone(storage, api.user);
    if (!copies.length) { fill(kept); return; }
    const first = copies.find((copy) => copy.kind === "rough") || copies[0];
    const href = first.kind === "rough" ? voiceHash() : pieceHash(String(first.roughFile || "").replace(/\.md$/, ""));
    fill(kept, h("content-card", { heading: say("home.voiceKept") }, h("action-button", { variant: "secondary", href }, say("home.voiceKeptOpen"))));
  }

  async function setDismissed(dismissed) {
    await api.post("voice/invitation", { dismissed });
  }

  function paintInvite(show) {
    if (!show) { fill(invite); return; }
    const headingId = "studio-home-voice-h";
    const no = h("action-button", { variant: "secondary", onClick: async () => {
      no.loading = true;
      try {
        await setDismissed(true);
      } catch (error) {
        no.loading = false;
        if (error?.status === 401) throw error;
        // It stays, and says so: nothing was remembered.
        said.tell(say("home.voiceInviteNotSaved"), { variant: "problem" });
        return;
      }
      fill(invite);
      toast(say("home.voiceInviteGone"));
      said.tell(say("home.voiceInviteGone"), { undoLabel: say("home.voiceInviteUndo"), focus: true, undo: async () => {
        try { await setDismissed(false); } catch (error) { if (error?.status === 401) throw error; return; }
        said.clear();
        paintInvite(true);
        requestAnimationFrame(() => invite.querySelector("h3")?.focus());
      } });
    } }, say("home.voiceInviteDismiss"));
    fill(invite, h("section", { class: "studio-comment studio-home-voice-card", "aria-labelledby": headingId },
      h("h3", { id: headingId, tabindex: "-1", text: say("home.voiceInviteHeading") }),
      h("p", { text: say("home.voiceInviteText") }),
      h("div", { class: "studio-comment-actions" }, h("action-button", { href: voiceHash() }, say("home.voiceInviteStart")), no)));
  }

  async function load() {
    paintKept();
    // Useless without a helper, so nothing is asked of the server when there is none.
    if (meta.quizGeneration !== true || onboardingOwnsIt()) { paintInvite(false); return; }
    try {
      const [status, helper] = await Promise.all([api.get("voice/status"), api.get("assistant/status")]);
      paintInvite(invitationVisible({ dismissed: false, status, helperReady: helper?.configured === true, onboardingOwnsIt: onboardingOwnsIt() }));
    } catch {
      paintInvite(false);
    }
  }

  return { element, load };
}

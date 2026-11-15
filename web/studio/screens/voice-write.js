// Write a piece (Studio R9, #/voice/write[?pack=<id>]): "Write for three minutes." One section;
// its steps replace each other: choose a prompt, write against the server's clock, then the rough
// draft saved and a copy to polish (parts/voice-write.js, parts/voice-piece.js). Leaving while
// the clock runs asks first; the rough draft never counts as unsaved once it is on the server.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { createVoiceWrite } from "../parts/voice-write.js";
import { createVoicePiece } from "../parts/voice-piece.js";
import { pieceHash } from "../parts/voice-rules.js";

export async function createVoiceWriteScreen(context, route = {}) {
  const { api } = context;
  await use("action-button", "breadcrumb-trail");
  const host = h("div", { class: "studio-voice-host" });
  const element = h("section", { class: "studio-page studio-voice-write-page", "aria-label": say("voice.writeTitle") },
    h("breadcrumb-trail", { items: [{ label: say("voice.home"), href: "#/" }, { label: say("voice.title"), href: "#/voice" }, { label: say("voice.writeTitle"), href: "" }] }),
    host);
  let piece = null;

  const writer = await createVoiceWrite({
    api, user: api.user, pack: route.query?.pack || null, backHref: "#/voice",
    onPack: () => context.replaceRoute?.("#/voice/write"),
    onSaved: (answer) => showSaved(answer),
  });

  async function showSaved(answer) {
    const sample = answer?.sample;
    if (!sample) { context.go("#/voice"); return; }
    piece?.destroy();
    piece = await createVoicePiece({ api, user: api.user, rough: sample, go: context.go });
    const heading = h("h2", { class: "studio-question", tabindex: "-1", text: say("voice.lockedHeading") });
    const another = h("action-button", { variant: "secondary", onClick: () => {
      if (piece?.isDirty()) { piece.saveFirst(); return; }
      piece?.destroy();
      piece = null;
      fill(host, writer.element);
      writer.showChoose();
    } }, say("voice.another"));
    // The writer stays on the page (empty now): its live region is saying the rough draft is saved.
    fill(host,
      writer.element, heading,
      answer.expired ? h("p", { class: "studio-help", text: say("voice.lockedTimeUp") }) : null,
      piece.element,
      h("a", { class: "studio-more-link", href: pieceHash(), text: say("voice.toList") }),
      h("div", { class: "studio-write-bar" }, another, piece.saveButton));
    requestAnimationFrame(() => heading.focus());
  }

  fill(host, writer.element);

  return {
    title: say("voice.writeTitle"),
    element,
    load: () => writer.load(),
    // The screen moves focus itself as each step shows.
    focus: () => {},
    isDirty: () => writer.isRunning() || Boolean(piece?.isDirty()),
    async leave() {
      if (piece) {
        if (!(await piece.leave())) return false;
        piece.destroy();
        return true;
      }
      if (!(await writer.leave())) return false;
      writer.destroy();
      return true;
    },
    keys: ["save", "publish"],
    command(id) {
      if (piece) { if (id === "save" || id === "publish") piece.keys(id === "save" ? "s" : "enter"); return; }
      if (id === "publish") writer.keys("enter");
    },
  };
}

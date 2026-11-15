// A piece (Studio R9, #/voice/piece/<id>): read a rough draft, polish a copy, make a post from it.
// The same rough-and-polish block as after writing (parts/voice-piece.js). A polished piece opens
// with focus in its editor, a rough one on the heading.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { createVoicePiece } from "../parts/voice-piece.js";
import { dateText, voiceProblem } from "../parts/voice-rules.js";

export async function createVoicePieceScreen(context, id = "") {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "skeleton-block");
  const heading = h("h2", { id: "studio-piece-h", class: "studio-question", tabindex: "-1", text: say("voice.pieceTitle") });
  const meta = h("p", { class: "studio-meta" });
  const host = h("div", { class: "studio-voice-host" }, h("skeleton-block", { lines: 6 }));
  const bar = h("div", { class: "studio-write-bar", hidden: true });
  const crumb = h("breadcrumb-trail", { items: [{ label: say("voice.home"), href: "#/" }, { label: say("voice.title"), href: "#/voice" }, { label: say("voice.pieceTitle"), href: "" }] });
  const element = h("section", { class: "studio-page studio-voice-piece-page", "aria-labelledby": "studio-piece-h" }, crumb, heading, meta, host, bar);
  let piece = null;
  let focusEditor = false;

  const backLink = () => h("a", { class: "studio-more-link", href: "#/voice", text: say("voice.backToList") });
  const forHelper = (problem) => (problem.details ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${problem.code}: ${problem.details}` })) : null);

  async function load() {
    let first;
    try {
      first = await api.get(`voice/samples/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = voiceProblem(error);
      fill(host, problem.code === "gone"
        ? h("alert-banner", { variant: "info" }, h("p", { text: say("voice.pieceGone") }), backLink())
        : h("alert-banner", { variant: problem.signal ? "info" : "danger" }, h("p", { text: problem.signal ? say("voice.noSignalList") : say("voice.loadFailed") }), forHelper(problem),
          h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      return;
    }
    // Opened by either file of the pair: the rough draft is the piece, the polished copy its partner.
    let rough = first.stage === "rough" ? first : null;
    let polished = first.stage === "polished" ? first : null;
    try {
      if (!rough && first.partner?.id) rough = await api.get(`voice/samples/${encodeURIComponent(first.partner.id)}?visibility=${encodeURIComponent(first.visibility)}`);
      if (!polished && first.partner?.id) polished = await api.get(`voice/samples/${encodeURIComponent(first.partner.id)}?visibility=${encodeURIComponent(first.visibility)}`);
    } catch (error) {
      if (error?.status === 401) throw error;
    }
    const title = String((rough || first).promptTitle || (rough || first).title || "");
    heading.textContent = title || say("voice.pieceTitle");
    context.setTitle?.(title || say("voice.pieceTitle"));
    if (!rough || typeof rough.body !== "string") {
      fill(host, h("alert-banner", { variant: "warning" }, h("p", { text: say("voice.pieceNoRough") }), h("p", { class: "studio-help", text: say("common.tell") }),
        first.guidance ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: String(first.guidance) })) : null), backLink());
      return;
    }
    const usable = polished && typeof polished.body === "string" ? polished : null;
    const date = dateText((usable || rough).date);
    meta.textContent = usable ? say("voice.pieceBoth", { date }) : say("voice.pieceRough", { date });
    piece = await createVoicePiece({ api, user: api.user, rough, polished: usable, go: context.go });
    fill(host, piece.element, backLink());
    fill(bar, piece.saveButton);
    bar.hidden = false;
    focusEditor = Boolean(usable);
    if (focusEditor) piece.focus();
  }

  return {
    title: say("voice.pieceTitle"),
    element,
    load,
    focus: () => { if (!focusEditor) heading.focus(); },
    isDirty: () => Boolean(piece?.isDirty()),
    async leave() {
      if (piece && !(await piece.leave())) return false;
      piece?.destroy();
      return true;
    },
    keys: ["save", "publish"],
    command(cmd) { if (piece && (cmd === "save" || cmd === "publish")) piece.keys("s"); },
  };
}

// Your name on it (the reflection's ?sheet=name, #650): how readers see this writer's name with
// their part: their name as People has it (with its link, frozen when chosen), a name they write
// here, or none. A new reflection asks everyone whose part is in it before anyone reads the whole
// thing to agree; changing it later asks once, because everyone then agrees again, and can be
// undone. The server keeps the choice private until the piece is published.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { ask } from "./dialogs.js";
import { nameChoice, nameSaid, togetherProblem } from "./together-rules.js";

export async function createNameSheet({ api, id, onChange }) {
  await use("action-button", "choice-cards", "text-field");
  const sheet = await createSheet({ label: say("name.title"), wide: false });
  const did = createDidLine();
  const now = h("p", { role: "status" });
  const body = h("div", { class: "studio-together-shape" });
  let stored = null; // { revision, choice }
  let typed = false;
  let kind = null;
  let name = null;

  async function open(summary, opener) {
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    typed = false;
    sheet.show({ heading: say("name.sheetTitle", { title }), opener, dirty: () => typed, save: () => save(),
      question: { heading: say("together.leaveAsk"), text: say("name.lede"), save: say("name.save"), leave: say("together.leaveGo") },
      children: [h("p", { class: "studio-help", text: say("name.lede") }), now, did.element, body],
      focus: () => body.querySelector("input, button")?.focus() });
    await load();
  }

  async function load() {
    try {
      stored = await api.get(`collaboration/credit-choice?publicationId=${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.status === 401) throw error;
      body.replaceChildren(h("p", { class: "studio-help", text: togetherProblem(error).words }));
      return;
    }
    const choice = stored.choice || null;
    now.textContent = nameSaid(choice);
    kind = h("choice-cards", { label: say("name.choose"), value: choice?.kind || "",
      items: [
        { id: "profile", title: say("name.people"), detail: say("name.peopleHelp") },
        { id: "displayName", title: say("name.typed") },
        { id: "uncredited", title: say("name.off"), detail: say("name.offHelp") },
      ],
      onValuechange: (e) => { if (e.detail) kind.value = e.detail; typed = true; paint(); } });
    name = h("text-field", { label: say("name.typedLabel"), autocomplete: "name", maxlength: 200,
      value: choice?.kind === "displayName" ? String(choice.name || "") : "", onValuechange: () => { typed = true; } });
    body.replaceChildren(kind, name,
      h("div", { class: "studio-sheet-footer" }, h("action-button", { onClick: () => save() }, say("name.save"))));
    paint();
  }

  function paint() {
    if (name) name.hidden = kind?.value !== "displayName";
  }

  /** Save her choice, or (undoing) the one before it. */
  async function save(undo = undefined) {
    const before = stored?.choice || null;
    let choice = undo;
    if (choice === undefined) {
      const asked = nameChoice(String(kind?.value || ""), name?.value);
      if (asked.error) {
        if (asked.field === "name") {
          name.error = asked.error;
          name.querySelector("input")?.focus();
        } else {
          did.tell(asked.error, { variant: "problem" });
          kind.focus?.();
        }
        return false;
      }
      choice = asked.choice;
      if (name) name.error = "";
      // A change to a choice already made clears everyone's agreement: ask once.
      if (before && !sameChoice(before, choice)) {
        const go = await ask({ heading: say("name.changeAsk"), text: say("name.changeText"),
          choices: [{ label: say("name.changeGo"), value: "go" }, { label: say("name.changeKeep"), value: "keep", variant: "secondary" }] });
        if (go !== "go") return false;
      }
    }
    try {
      await api.put("collaboration/credit-choice", { publicationId: id, expectedRevision: stored?.revision ?? 0, choice });
      typed = false;
      const undoTo = before ? requestOf(before) : null;
      did.tell(before ? say("name.savedAgain") : say("name.saved"), undo === undefined && undoTo ? { undo: () => save(undoTo), undoLabel: say("part.undo") } : {});
      await load();
      onChange?.();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(error.status === 409 ? say("together.changedElsewhere", { what: say("name.title") }) : togetherProblem(error).words, { variant: "problem" });
      await load();
      return false;
    }
  }

  return { sheet, open };
}

/** The request that writes a stored choice again (Undo). A frozen People name is chosen again as it is now. */
function requestOf(choice) {
  if (choice.kind === "displayName") return { kind: "displayName", name: String(choice.name || "") };
  return { kind: choice.kind === "profile" ? "profile" : "uncredited" };
}

function sameChoice(stored, asked) {
  if (stored.kind !== asked.kind) return false;
  return asked.kind !== "displayName" || String(stored.name || "") === asked.name;
}

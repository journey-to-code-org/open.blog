// Sharing with people you choose (#705, the "namedRecipients" way of reading each other's parts).
// A writer picks who receives the version she has now; later changes stay private, and a copy
// someone has read can't be taken back, so the question names the people and says so before
// anything is sent. Someone who only reads gets "Shared with you": only the versions named for
// them. Other people's words are text, never markup.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say, sayParts } from "./words.js";
import { partsNodes } from "./stranger.js";
import { chosenReaders, partParagraphs, readerChoices, sharedWithYou } from "./part-rules.js";
import { joinNames } from "./together-rules.js";

/**
 * Asks who reads it. `people` are the reveal slots that may receive. Resolves to
 * `{ ids, names }`, or null when she closes it or chooses nobody.
 */
export async function chooseReaders({ people, parts = 1 }) {
  await use("modal-dialog", "action-button", "alert-banner");
  const choices = readerChoices(people);
  return new Promise((resolve) => {
    let answered = false;
    const picked = new Set();
    const problem = h("p", { class: "studio-field-error", role: "alert", hidden: true });
    const dialog = h("modal-dialog", { label: say("named.ask"), class: "studio-dialog" }, h("span", { slot: "heading", text: say("named.ask") }));
    const done = (value) => { answered = true; dialog.open = false; dialog.remove(); resolve(value); };
    if (!choices.length) {
      dialog.append(h("p", { text: say("named.nobody") }), h("action-button", { slot: "actions", onClick: () => done(null) }, say("named.close")));
    } else {
      const boxes = choices.map((person, index) => {
        const boxId = `studio-named-${index}`;
        const input = h("input", { type: "checkbox", id: boxId, class: "studio-radio", onChange: (e) => { if (e.target.checked) picked.add(person.id); else picked.delete(person.id); problem.hidden = true; } });
        return h("div", { class: "studio-choice" }, input, h("label", { for: boxId }, h("bdi", { class: "studio-stranger", dir: "auto", text: person.name })));
      });
      dialog.append(
        h("p", { text: parts > 1 ? say("named.askAllParts", { n: parts }) : say("named.askText") }),
        h("fieldset", { class: "studio-named-people" }, h("legend", { text: say("named.who") }), ...boxes),
        h("p", { class: "studio-help", text: say("named.cantTakeBack") }), problem,
        h("action-button", { slot: "actions", onClick: () => {
          const chosen = choices.filter((person) => picked.has(person.id));
          if (!chosen.length) { problem.textContent = say("named.chooseSomeone"); problem.hidden = false; dialog.querySelector("input")?.focus(); return; }
          done({ ids: chosen.map((person) => person.id), names: chosen.map((person) => person.name) });
        } }, say("named.go")),
        h("action-button", { slot: "actions", variant: "secondary", onClick: () => done(null) }, say("named.no")));
    }
    dialog.addEventListener("openchange", (event) => { if (!event.detail && !answered) { dialog.remove(); resolve(null); } });
    document.body.append(dialog);
    dialog.open = true;
    requestAnimationFrame(() => (dialog.querySelector("input") || dialog.querySelector("action-button .action-button"))?.focus());
  });
}

/**
 * "Shared with you", for someone who only reads: the versions named for them
 * (`GET collaboration/contributions/shared`), each under its writer's name. Returns the nodes.
 */
export function sharedWithYouNodes(reply, people) {
  const shared = sharedWithYou(reply, people);
  if (!shared.length) return [h("p", { class: "studio-help", text: say("named.nothingYet") })];
  return shared.map((writer, index) => {
    const headingId = `studio-named-part-${index}`;
    const several = writer.texts.length > 1;
    const nodes = writer.texts.flatMap((text, at) => {
      const words = partParagraphs(text);
      return [
        several ? h("p", { class: "studio-help", text: say("extra.partLabel", { n: at + 1 }) }) : null,
        words.length ? h("div", { class: "studio-stranger studio-together-words", dir: "auto" }, ...words.map((w) => (w.kind === "p" ? h("p", { dir: "auto", text: w.text }) : h("p", { class: "studio-part-rule", role: "separator", text: w.label }))))
          : h("p", { class: "studio-help", text: say("named.empty") }),
      ].filter(Boolean);
    });
    return h("section", { class: "studio-together-slot", "aria-labelledby": headingId },
      h("h3", { id: headingId, class: "studio-together-h3" }, ...partsNodes(sayParts("named.from", { name: writer.name || say("named.someone") }, ["name"]))),
      ...nodes);
  });
}

/** Whom she has chosen so far, as lines for under her words; nothing when she has chosen nobody. */
export function whoReadsNodes(slots, isolate) {
  const { newest, earlier } = chosenReaders(slots);
  return [
    newest.length ? h("p", { class: "studio-help" }, ...partsNodes(sayParts("named.readsNewest", { names: joinNames(newest, isolate) }, ["names"]))) : null,
    earlier.length ? h("p", { class: "studio-help" }, ...partsNodes(sayParts("named.readsEarlier", { names: joinNames(earlier, isolate) }, ["names"]))) : null,
  ].filter(Boolean);
}

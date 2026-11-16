// What a reader's note brings with it on its card (Studio R10, "The card" 8, 9, 12, 17): their link
// and wording, About this reflection / idea / answer, What they point to, an idea's contact, Your
// answer under it (with Undo), Answer as {author} / Take my answer back, and the buttons that open the
// sheets (parts/reader-sheets.js). Strangers' words are text, isolated; a link they sent is shown in
// full with Copy and Open (http(s) only, no referrer) and never fetched. docs/specs/studio/r10/ux.md.
import { h } from "./dom.js";
import { say, sayParts, isolating } from "./words.js";
import { ask } from "./dialogs.js";
import { sendOut, wentOutWords } from "./publish.js";
import { partsNodes, strangerBody } from "./stranger.js";
import { claimsHash } from "./research-rules.js";
import {
  ANSWER_MAX, aboutHeading, aboutLines, answerOffer, answerRequest, continuationCardState, evidenceLines, extrasProblem, featureCardState, noteWords, openableLink,
  theirOffer, withdrawAnswerRequest, libraryCandidateLines,
} from "./reader-notes-rules.js";

const copyText = async (text) => {
  try { await navigator.clipboard.writeText(String(text)); return true; } catch { return false; }
};

/**
 * `{ details(item, row), extras(item, row, line), isDirty() }` for createReaderCard's `on.details` /
 * `on.extras`. `state()` gives `{ published: Map(id → entry), etag, features: Map(id → feature) }`;
 * `tell(words, { undo })` says what happened on the screen (with Undo); `reload(ref)` reloads keeping
 * the card; `sheets` opens the side sheets.
 */
export function createReaderExtras({ api, meta, state, tell, reload, sheets }) {
  const dirty = new Map(); // ref → () => boolean, for the leave-guard

  function details(item, row) {
    const { link, wording } = theirOffer(item);
    if (link) {
      const open = openableLink(link)
        ? h("a", { class: "studio-link-button", href: link, target: "_blank", rel: "noopener noreferrer nofollow", referrerpolicy: "no-referrer", "aria-label": say("readers.openLinkLabel"), text: say("readers.openIt") })
        : null;
      const said = h("span", { class: "studio-help", role: "status" });
      row.append(h("div", { class: "studio-reader-block", "data-block": "their-link" },
        h("p", { class: "studio-label", text: say("readers.theirLink") }),
        h("p", { class: "studio-stranger studio-mono", dir: "auto", text: link }),
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", size: "sm", label: say("readers.copyLinkLabel"), onClick: async () => { said.textContent = (await copyText(link)) ? say("readers.copiedIt") : link; } }, say("readers.copyIt")),
          open, said),
        h("p", { class: "studio-help", text: say("readers.notChecked") })));
    }
    if (wording) row.append(h("div", { class: "studio-reader-block", "data-block": "their-wording" }, h("p", { class: "studio-label", text: say("readers.theirWording") }), strangerBody(wording)));

    const about = aboutHeading(item);
    const lines = aboutLines(item, isolating);
    if (about && lines.length) {
      const headingText = about === "readers.aboutReflection" ? say("readers.aboutReflection") : about === "readers.aboutIdea" ? say("readers.aboutIdea") : say("readers.aboutAnswer");
      row.append(h("div", { class: "studio-reader-block", "data-block": "about" },
        h("p", { class: "studio-label", text: headingText }), h("ul", { class: "studio-reader-lines" }, ...lines.map((l) => h("li", {}, ...partsNodes(l))))));
    }

    const evidence = evidenceLines(item.evidence, isolating);
    if (evidence.length) {
      const claim = item.evidence?.claim;
      row.append(h("div", { class: "studio-reader-block", "data-block": "evidence" },
        h("p", { class: "studio-label", text: say("readers.evidenceHeading") }),
        h("p", { class: "studio-help", text: say("readers.evidenceNote") }),
        h("ul", { class: "studio-reader-lines" }, ...evidence.map((l) => h("li", {}, ...partsNodes(l)))),
        claim?.published && claim.links?.length ? h("details", { class: "studio-help" }, h("summary", { text: say("readers.evidenceCompare", { label: String(claim.label || claim.id || "") }) }),
          h("ul", {}, ...claim.links.map((l) => h("li", { class: "studio-stranger", dir: "auto", text: String(l.label || "") })))) : null,
        // R12: the claim they named opens in this post's Claims and evidence.
        claim?.id && claimsHash(item.post?.source, claim.id)
          ? h("action-button", { variant: "secondary", size: "sm", href: claimsHash(item.post.source, claim.id) }, say("readers.evidenceOpenClaim")) : null));
    }

    if (item.suggestion?.contact) {
      const contact = String(item.suggestion.contact);
      const said = h("span", { class: "studio-help", role: "status" });
      row.append(h("div", { class: "studio-reader-block", "data-block": "contact" },
        h("p", {}, ...partsNodes(sayParts("readers.ideaContact", { contact }, ["contact"]))),
        h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", size: "sm", label: say("readers.copyContactLabel"), onClick: async () => { said.textContent = (await copyText(contact)) ? say("readers.copiedIt") : contact; } }, say("readers.copyIt")), said),
        h("p", { class: "studio-help", text: say("readers.ideaContactHelp") })));
    }
    if (item.suggestion?.libraryCandidate) {
      const candidate = libraryCandidateLines(item.suggestion.libraryCandidate);
      if (candidate.length) row.append(h("details", { class: "studio-help", "data-block": "candidate" }, h("summary", { text: say("readers.ideaSourceDetails") }), h("ul", {}, ...candidate.map((t) => h("li", { class: "studio-stranger", dir: "auto", text: t })))));
    }
  }

  function extras(item, row, line) {
    const ref = `${item.source}:${item.id}`;
    const entry = state().published.get(item.id);
    if (entry && item.role === "site-admin") row.append(answerUnder(item, entry, ref, line));
    const buttons = [];
    const open = (what) => (e) => sheets[what](item, e.currentTarget);
    if (entry && item.post?.source) buttons.push(h("action-button", { variant: "secondary", size: "sm", "data-extra": "change", onClick: open("change") }, say("readers.changeButton")));
    if (featureCardState(item, state().features.get(item.id))) buttons.push(h("action-button", { variant: "secondary", size: "sm", "data-extra": "feature", onClick: open("feature") }, say("readers.featureButton")));
    if (continuationCardState(item)) buttons.push(h("action-button", { variant: "secondary", size: "sm", "data-extra": "link", onClick: open("link") }, say("readers.linkButton")));
    if (item.recordDecision) buttons.push(h("action-button", { variant: "secondary", size: "sm", "data-extra": "decide", onClick: open("decide") }, say("readers.decideButton")));
    if (item.suggestion?.link) buttons.push(h("action-button", { variant: "secondary", size: "sm", "data-extra": "idea-link", onClick: open("ideaLink") }, say("readers.ideaLinkButton")));
    if (buttons.length) row.append(h("div", { class: "studio-comment-actions studio-reader-extras" }, ...buttons));
    const offer = answerOffer(item);
    if (offer) row.append(answerAs(item, offer, ref, line));
    if (item.response?.withdrawable) {
      row.append(h("div", { class: "studio-comment-actions" }, h("action-button", { variant: "secondary", size: "sm", "data-extra": "withdraw", onClick: (e) => withdraw(item, line, e.currentTarget) }, say("readers.withdrawButton"))));
    }
  }

  // ---- Your answer under it (PUT engagement/feedback/response, with the published file's etag)

  function answerUnder(item, entry, ref, line) {
    const saved = String(entry.response?.text ?? "");
    const field = h("text-field", { label: say("readers.answerLabel"), description: say("readers.answerHelp"), rows: 4, maxlength: ANSWER_MAX, value: saved, class: "studio-reader-answer" });
    const valueOf = () => String(field.value ?? "");
    dirty.set(ref, () => valueOf() !== saved);
    const save = h("action-button", { size: "sm", onClick: () => put(valueOf(), save) }, say("readers.answerSave"));
    const remove = saved ? h("action-button", { variant: "ghost", size: "sm", onClick: () => put(null, remove) }, say("readers.answerRemove")) : null;
    field.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); put(valueOf(), save); } });

    async function put(text, control, { undoing = false } = {}) {
      if (text !== null && !String(text).trim()) { field.error = say("readers.answerEmpty"); field.querySelector("textarea, input")?.focus(); return; }
      field.error = "";
      if (control) control.loading = true;
      try {
        const reply = await api.put("engagement/feedback/response", { id: item.id, etag: state().etag, response: text });
        if (reply?.etag) state().etag = reply.etag;
        dirty.delete(ref);
        const out = await sendOut(api, "An answer under a reader's note");
        const went = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
        const words = `${undoing ? say("readers.answerBack") : text === null ? say("readers.answerRemoved") : say("readers.answerSaved")} ${went}`.trim();
        tell(words, undoing ? {} : { undo: () => putBack(saved) });
        await reload(ref);
      } catch (error) {
        if (error.status === 401) throw error;
        const problem = extrasProblem(error, "answer");
        if (problem.id === "readers.answerChanged") { dirty.delete(ref); await reload(ref); }
        field.error = noteWords(problem);
        line.textContent = noteWords(problem);
        line.hidden = false;
      } finally {
        if (control) control.loading = false;
      }
    }
    // Undo puts the text that was there before back (the etag is re-read with the list).
    const putBack = (text) => put(text === "" ? null : text, null, { undoing: true });
    return h("div", { class: "studio-reader-block", "data-block": "answer-under" }, field, h("div", { class: "studio-row" }, save, remove));
  }

  // ---- Answer as {author} / Take my answer back

  function answerAs(item, offer, ref, line) {
    const field = h("text-field", { label: say("readers.answerAsLabel", { author: offer.author }), description: offer.help, rows: 4, maxlength: ANSWER_MAX, class: "studio-reader-answer-as" });
    const valueOf = () => String(field.value ?? "");
    dirty.set(`${ref}:as`, () => valueOf().trim() !== "");
    const send = h("action-button", { size: "sm", onClick: async () => {
      if (!valueOf().trim()) { field.error = say("readers.answerAsEmpty"); return; }
      field.error = "";
      send.loading = true;
      try {
        await api.post("engagement/author-response", answerRequest(item, valueOf()));
        dirty.delete(`${ref}:as`);
        tell(say("readers.answerSent"));
        await reload(ref);
      } catch (error) {
        if (error.status === 401) throw error;
        field.error = noteWords(extrasProblem(error, "answerAs"));
      } finally {
        send.loading = false;
      }
    } }, say("readers.answerAsSend"));
    return h("div", { class: "studio-reader-block", "data-block": "answer-as" }, field, h("div", { class: "studio-row" }, send));
  }

  async function withdraw(item, line, control) {
    const choice = await ask({ heading: say("readers.withdrawTitle"), text: say("readers.withdrawText"),
      choices: [{ label: say("readers.withdrawKeep"), value: "keep", variant: "secondary" }, { label: say("readers.withdrawGo"), value: "go", variant: "destructive" }] });
    if (choice !== "go") return;
    control.loading = true;
    try {
      await api.patch("engagement/author-response", withdrawAnswerRequest(item));
      tell(say("readers.withdrawn"));
      await reload(`${item.source}:${item.id}`);
    } catch (error) {
      if (error.status === 401) throw error;
      line.textContent = noteWords(extrasProblem(error, "answerAs"));
      line.hidden = false;
    } finally {
      control.loading = false;
    }
  }

  return {
    details,
    extras,
    isDirty: () => [...dirty.values()].some((d) => d()),
    forget: () => dirty.clear(),
  };
}

// Readers' decisions (Studio R10, split from screens/readers.js): deciding one note, fixing what
// is on the post, the More menu, keeping the list after a change elsewhere, and the one Undo
// banner. The screen owns the list (`state.items`, `state.page`, `state.next`); this part changes
// it and asks the screen to draw. docs/specs/studio/r10/ux.md.
import { h, toast } from "./dom.js";
import { ask } from "./dialogs.js";
import { sendOut, siteLink, wentOutWords } from "./publish.js";
import { say, sayParts } from "./words.js";
import { fixOpposite, noteWords, extrasProblem } from "./reader-notes-rules.js";
import {
  viewOf, viewLabel, readersHash, reasonWords, quietReason, reportReason, decisionRequest, needsAcknowledge, didWords, undoWords,
  readerProblem, problemWords, readerWords, bulkRequest, bulkOutcome, fixRoute, VIEWS,
} from "./reader-rules.js";

/**
 * @param {{ api: object, meta: object, view: object, state: { items: object[], page: object|null, next: string|null, undo: object|null },
 *   list: HTMLElement, status: HTMLElement, heading: HTMLElement, undoSlot: HTMLElement,
 *   draw: () => void, load: () => Promise<void>, focusCard: (ref: string) => void, fetchPage: (cursor: string|null) => Promise<object> }} ctx
 */
export function createReaderDecisions(ctx) {
  const { api, meta, view, state, list, status, heading, undoSlot, draw, focusCard, fetchPage } = ctx;
  const busy = new Set();
  const refOf = (item) => `${item.source}:${item.id}`;

  async function startDecision(item, b, line, control) {
    if (b.action === "erase") {
      const choice = await ask({
        heading: sayParts("readers.eraseTitle", { name: item.reader?.name || say("readers.someone"), kind: item.source === "report" ? say("readers.kind.abuseReport").toLowerCase() : say("readers.kind.comment").toLowerCase() }, item.reader?.name ? ["name"] : []),
        text: say("readers.eraseText"),
        choices: [{ label: say("readers.eraseKeep"), value: "keep", variant: "secondary" }, { label: say("readers.eraseYes"), value: "erase", variant: "destructive" }],
      });
      return choice === "erase" ? decide(item, "erase", null, line, control) : undefined;
    }
    if (b.asks) {
      const choice = await ask({
        heading: say("readers.whyTitle"),
        text: b.offer.guidance && b.offer.guidance.length < 120 ? b.offer.guidance : say("readers.whyText"),
        choices: [...b.offer.reasons.map((r) => ({ label: reasonWords(r), value: r.id, variant: "secondary" })), { label: say("readers.cancel"), value: "", variant: "ghost" }],
      });
      return choice ? decide(item, b.action, choice, line, control) : undefined;
    }
    if (needsAcknowledge(item, b.action)) {
      const postUrl = item.post?.url ? siteLink(meta, item.post.url) : "";
      const choice = await ask({
        heading: say("readers.ackTitle"), text: say("readers.ackText"),
        choices: [{ label: say("readers.ackNo"), value: "no", variant: "primary" }, { label: say("readers.ackYes"), value: "yes", variant: "secondary" }, ...(postUrl ? [{ label: say("readers.ackOpen"), value: "open", variant: "ghost" }] : [])],
      });
      if (choice === "open") { window.open(postUrl, "_blank", "noopener"); return; }
      return choice === "yes" ? decide(item, b.action, null, line, control, { acknowledged: true }) : undefined;
    }
    const reason = item.source !== "report" ? null : b.action === "reject" ? quietReason(b.offer) : b.action === "uphold-report" ? reportReason(item) : null;
    return decide(item, b.action, reason, line, control);
  }

  async function decide(item, action, reason, line, control, options = {}) {
    const ref = refOf(item);
    if (busy.has(ref)) return;
    busy.add(ref);
    if (control && "loading" in control) control.loading = true;
    line.hidden = true;
    try {
      const reply = await api.patch("engagement/moderation", decisionRequest(item, action, reason, options));
      let said = didWords(item, action, reply).text;
      if (reply.publishError) said += ` ${say("readers.postNotUpdated")}`;
      if (reply.continuationsError) said += ` ${say("readers.linksNotUpdated")}`;
      if (reply.published) {
        const out = await sendOut(api, "A note from a reader");
        const sent = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
        said = `${said} ${sent}`.trim();
      }
      const index = state.items.findIndex((i) => refOf(i) === ref);
      state.items = state.items.filter((i) => refOf(i) !== ref);
      draw();
      status.textContent = said;
      toast(said);
      const near = state.items[index] || state.items[index - 1];
      if (near) focusCard(refOf(near));
      else requestAnimationFrame(() => list.querySelector("empty-state")?.focus?.() || heading.focus());
      const undoText = undoWords(item, action);
      if (undoText && reply?.item?.version) offerUndo({ ...item, ...reply.item, source: item.source }, undoText);
      else if (action !== "reopen") clearUndo();
    } catch (error) {
      if (error.status === 401) throw error;
      const problem = readerProblem(error, "card");
      if (problem.reload) {
        await reloadKeeping(ref, problem.id);
        return;
      }
      line.textContent = problemWords(problem);
      line.hidden = false;
      line.focus();
    } finally {
      busy.delete(ref);
      if (control && "loading" in control) control.loading = false;
    }
  }

  async function reloadKeeping(ref, id) {
    const want = state.items.length;
    try {
      let fresh = await fetchPage(null);
      let all = fresh.items || [];
      while (fresh.next && all.length < want) {
        fresh = await fetchPage(fresh.next);
        all = all.concat(fresh.items || []);
      }
      state.page = { ...fresh, invalid: state.page?.invalid || 0 };
      state.items = all;
      state.next = fresh.next || null;
      draw();
      if (state.items.some((i) => refOf(i) === ref)) {
        focusCard(ref);
        const line = list.querySelector(`[data-ref="${ref}"] .studio-comment-trouble`);
        if (line && id) { line.textContent = readerWords(id); line.hidden = false; }
      } else if (id) {
        status.textContent = say("readers.decidedElsewhere");
        heading.focus();
      }
    } catch (error) {
      status.textContent = problemWords(readerProblem(error, "list"));
    }
  }

  // What is on the post: one button, the opposite call for Undo.
  async function fix(item, fixState, line, control, { undoing = false } = {}) {
    if (control) control.loading = true;
    try {
      const body = { id: item.id, version: item.version };
      await api.post(fixRoute(item, fixState.action), body);
      const out = await sendOut(api, "A note from a reader");
      const went = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
      const said = `${undoing ? say("readers.fixUndone") : say("readers.fixDone")} ${went}`.trim();
      const back = fixOpposite(fixState.action);
      status.textContent = said;
      toast(said);
      if (!undoing && back) offerUndo(null, said, () => fix(item, { ...fixState, action: back }, line, null, { undoing: true }));
      await reloadKeeping(refOf(item), null);
    } catch (error) {
      if (error.status === 401) throw error;
      line.textContent = say("readers.fixFailed");
      line.hidden = false;
      line.focus();
    } finally {
      if (control) control.loading = false;
    }
  }

  async function moreMenu(item, value, line) {
    if (value === "copy-notes") {
      try {
        await api.post("engagement/suggestions/export", { id: item.id, version: item.version });
        status.textContent = say("readers.ideaCopied");
      } catch (error) {
        if (error.status === 401) throw error;
        if (error.status === 409) await reloadKeeping(refOf(item), "readers.changedHere");
        else { line.textContent = noteWords(extrasProblem(error, "export")); line.hidden = false; }
      }
      return;
    }
    if (value !== "copy-link") return;
    const link = `${location.origin}${location.pathname}${readersHash(viewOf(VIEWS.find((v) => v.state === item.status)?.id || "").id, "", refOf(item))}`;
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = say("readers.menuCopied");
    } catch {
      line.textContent = link;
      line.hidden = false;
    }
  }

  // ---- undo: the last no goes back to Waiting ---------------------------------------------------

  function showUndo(words) {
    const button = h("action-button", { size: "sm", onClick: () => runUndo() }, say("readers.undo"));
    const alert = h("alert-banner", { variant: "info", dismissible: true, heading: words }, button);
    alert.addEventListener("close", () => clearUndo());
    undoSlot.replaceChildren(alert);
  }

  /** The banner's one Undo: `item` goes back to Waiting, or `run` undoes something else (a fix, an answer). */
  function offerUndo(item, words, run = null) {
    state.undo = { item, words, run };
    showUndo(words);
  }

  /** Undo for many hidden at once: they all go back to Waiting. */
  function offerBulkUndo(done) {
    state.undo = { bulk: done, words: say("readers.bulkUndoNote", { n: done.length }) };
    showUndo(state.undo.words);
  }

  function clearUndo() {
    state.undo = null;
    undoSlot.replaceChildren();
  }

  let undoing = false;
  async function runUndo() {
    if (!state.undo || undoing) return;
    undoing = true;
    const { item, bulk, run } = state.undo;
    const button = undoSlot.querySelector("action-button");
    if (button) button.loading = true;
    try {
      if (run) {
        clearUndo();
        await run();
        return;
      }
      if (bulk) {
        const reply = await api.patch("engagement/moderation/batch", bulkRequest(bulk.map((i) => ({ ...i, status: "rejected" })), "reopen"));
        const back = bulkOutcome(bulk, reply).done.length;
        clearUndo();
        status.textContent = say("readers.bulkUndone", { n: back });
        await ctx.load();
        return;
      }
      await api.patch("engagement/moderation", decisionRequest(item, "reopen", null));
      clearUndo();
      status.textContent = say("readers.didBack");
      toast(say("readers.didBack"));
      if (view.state === "pending") await ctx.load();
    } catch (error) {
      if (error.status === 401) throw error;
      const there = VIEWS.find((v) => v.state === item.status) || VIEWS[0];
      status.textContent = error.status === 409 ? say("readers.undoChanged", { where: viewLabel(there) }) : problemWords(readerProblem(error, "card"));
    } finally {
      undoing = false;
      if (button) button.loading = false;
    }
  }

  return { startDecision, decide, reloadKeeping, fix, moreMenu, offerUndo, offerBulkUndo, clearUndo, runUndo };
}

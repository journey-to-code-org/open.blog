// Everyone's parts (Studio R14a, #/together/<id>/read): read what everyone wrote, see it as readers
// will, and agree to publish exactly that. Other people's parts are text, never markup (⚑ 8): split
// into paragraphs, each person's own direction, isolated from the page around it. The formatted
// view is the server's document in a frame with no allowances at all. Agreeing needs the preview's
// token (so she read it) and asks once; Undo takes the agreement back.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say, isolating } from "../parts/words.js";
import { partsNodes } from "../parts/stranger.js";
import { ask } from "../parts/dialogs.js";
import { createDidLine } from "../parts/did-line.js";
import { innerAria } from "../parts/inner-button.js";
import { previewSectionText, previewStateText, revealSlotText, togetherProblem } from "../parts/together-rules.js";
import { partParagraphs } from "../parts/part-rules.js";

export async function createTogetherRead(context, id, route = {}) {
  const { api } = context;
  const coWriter = context.meta?.account === "co-writer";
  await use("action-button", "alert-banner", "breadcrumb-trail", "skeleton-block");
  const heading = h("h2", { id: "studio-read-h", class: "studio-question", tabindex: "-1", text: say("read.title") });
  const crumb = h("breadcrumb-trail", { items: [] });
  const back = h("a", { class: "studio-more-link studio-back", href: `#/together/${encodeURIComponent(id)}` });
  const parts = h("div", { class: "studio-together-parts", "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const previewHost = h("div", { class: "studio-together-preview" });
  const lines = h("ul", { class: "studio-together-lines" });
  const state = h("p", { role: "status", "aria-live": "polite" });
  const did = createDidLine();
  const reason = h("p", { class: "studio-help", id: "studio-agree-why" });
  const seeButton = h("action-button", { variant: "secondary", onClick: () => preview() }, say("read.seeAsReaders"));
  const agreeButton = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => agree() }, say("read.agree"));
  const bar = h("div", { class: "studio-write-bar studio-together-bar" }, reason, agreeButton);
  const element = h("section", { class: "studio-page studio-together-read", "aria-labelledby": "studio-read-h" },
    crumb, back, heading, h("p", { class: "studio-lede", text: say("read.lede") }), parts, h("div", {}, seeButton), previewHost, state, lines, did.element, bar);
  let summary = null;
  let seen = "";
  let title = "";

  async function load() {
    try {
      const [listed, reveal] = await Promise.all([
        api.get("collaboration/publications"),
        api.get(`collaboration/reveal?publicationId=${encodeURIComponent(id)}`),
      ]);
      summary = (listed.publications || []).find((s) => s.publicationId === id) || null;
      if (!summary) throw Object.assign(new Error("gone"), { status: 404, data: { code: "not-found" } });
      title = summary.title || summary.guidingQuestion || say("together.untitled");
      back.textContent = say("together.backTo", { title });
      crumb.items = [...(coWriter ? [] : [{ label: say("together.home"), href: "#/" }]), { label: say("together.nav"), href: "#/together" },
        { label: title, href: `#/together/${encodeURIComponent(id)}` }, { label: say("read.title"), href: "" }];
      drawParts(reveal?.slots || []);
    } catch (error) {
      if (error.status === 401) throw error;
      parts.removeAttribute("aria-busy");
      fill(parts, h("alert-banner", { variant: error.status === 0 ? "info" : "danger" }, error.status === 404 ? say("together.gone") : togetherProblem(error).words,
        h("action-button", { variant: "secondary", href: "#/together" }, say("together.backToList"))));
      seeButton.hidden = true;
      bar.hidden = true;
      return;
    }
    paintAgree();
    if (route.query?.preview === "1") preview();
  }

  function drawParts(slots) {
    parts.removeAttribute("aria-busy");
    if (!slots.length) { fill(parts, h("p", { class: "studio-help", text: say("part.cantWrite") })); return; }
    fill(parts, ...slots.map((slot, index) => {
      const headingId = `studio-read-part-${index}`;
      const name = revealSlotText(slot, isolating);
      const readable = slot.kind === "own" || slot.kind === "revealed";
      const words = readable ? partParagraphs(String(slot.markdown || "")) : [];
      return h("section", { class: "studio-together-part", "aria-labelledby": headingId },
        h("h3", { id: headingId, class: "studio-together-h3" }, ...(slot.kind === "private" ? [h("bdi", { class: "studio-stranger", dir: "auto", text: slot.displayName || "" })] : partsNodes(name))),
        readable
          ? (words.length ? h("div", { class: "studio-stranger studio-together-words", dir: "auto" }, ...words.map((w) => (w.kind === "p" ? h("p", { dir: "auto", text: w.text }) : h("p", { class: "studio-part-rule", role: "separator", text: w.label }))))
            : h("p", { class: "studio-help", text: say("read.empty") }))
          : h("p", { class: "studio-help" }, ...partsNodes(name)),
        slot.kind === "own" && summary?.state !== "agreeing" && summary?.state !== "ready" ? h("p", { class: "studio-help", text: say("read.notSharedYou") }) : null);
    }));
  }

  async function preview() {
    // #650: the whole piece is read only once everyone whose part is in it said how their name goes on it.
    if (summary?.state === "naming") {
      const yours = summary.you?.credit === "notChosen";
      fill(state, h("span", { text: yours ? say("read.nameFirst") : say("read.namesFirst") }), " ",
        yours ? h("a", { href: `#/together/${encodeURIComponent(id)}?sheet=name`, text: say("together.doName") }) : null);
      paintAgree();
      return;
    }
    seeButton.loading = true;
    try {
      const reply = await api.get(`collaboration/preview?publicationId=${encodeURIComponent(id)}`);
      const p = reply?.preview || {};
      seen = p.ready || p.complete ? String(p.seen || "") : "";
      const frame = h("iframe", { class: "studio-preview-frame studio-together-frame", title: say("read.previewTitle", { title }) });
      frame.setAttribute("sandbox", "");
      frame.setAttribute("referrerpolicy", "no-referrer");
      if (typeof p.previewUrl === "string" && p.previewUrl.startsWith("/admin/api/preview/")) frame.setAttribute("src", p.previewUrl);
      fill(previewHost, h("p", { class: "studio-help", text: say("read.previewNote") }), frame);
      fill(state, ...partsNodes(previewStateText(p, isolating)));
      fill(lines, ...(p.sections || []).map((section) => h("li", {}, ...partsNodes(previewSectionText(section, isolating)))));
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error, "read").words, { variant: "problem" });
    } finally {
      seeButton.loading = false;
      paintAgree();
    }
  }

  function paintAgree() {
    const you = summary?.you || {};
    if (!you.drafter || summary?.state === "published") { bar.hidden = true; return; }
    bar.hidden = false;
    let why = "";
    if (summary.state === "naming") why = summary.you?.credit === "notChosen" ? say("read.nameFirst") : say("read.namesFirst");
    else if (!summary.complete) why = say("read.notAllShared");
    else if (you.agreed) why = say("read.alreadyAgreed");
    else if (!seen) why = you.agreedStale ? say("read.agreeStale") : say("read.readFirst");
    reason.textContent = why;
    agreeButton.label = say("read.agreeLabel", { title });
    // Never `disabled`: she can press it and be told why it waits.
    innerAria(agreeButton, { "aria-disabled": why ? "true" : null, "aria-describedby": "studio-agree-why" });
  }

  async function agree() {
    if (reason.textContent) { did.tell(reason.textContent); return; }
    const choice = await ask({ heading: say("read.agreeAsk"), text: say("read.agreeAskText"),
      choices: [{ label: say("read.agreeGo"), value: "go" }, { label: say("read.agreeNo"), value: "no", variant: "secondary" }] });
    if (choice !== "go") return;
    agreeButton.loading = true;
    try {
      await api.post("collaboration/approve", { publicationId: id, seen, affirmed: true });
      did.tell(say("read.agreed"), { undo: () => withdraw(), undoLabel: say("part.undo"), focus: true });
      await reload();
    } catch (error) {
      if (error.status === 401) throw error;
      seen = "";
      did.tell(error.status === 409 ? say("read.changedSinceRead") : togetherProblem(error, "read").words, { variant: "problem" });
      await reload();
    } finally {
      agreeButton.loading = false;
    }
  }

  async function withdraw() {
    try {
      await api.post("collaboration/approve/withdraw", { publicationId: id });
      did.tell(say("read.agreeUndone"));
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error, "read").words, { variant: "problem" });
    }
    await reload();
  }

  async function reload() {
    try {
      const listed = await api.get("collaboration/publications");
      summary = (listed.publications || []).find((s) => s.publicationId === id) || summary;
    } catch (error) {
      if (error.status === 401) throw error;
    }
    if (previewHost.childElementCount) await preview();
    else paintAgree();
  }

  return {
    title: say("read.title"),
    element,
    load,
    keys: ["publish"],
    command: (which) => { if (which === "publish") agree(); },
    focus: () => heading.focus(),
  };
}

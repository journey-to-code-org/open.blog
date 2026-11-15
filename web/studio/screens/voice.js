// Your writing voice (Studio R9, #/voice): "How do I sound, and what have I written?" The hub: one
// way to write a piece, her voice guide, and her pieces by set, newest first. No piece's words are
// loaded here. More holds Erase all your voice writing; where each file is kept, and moving it, is
// under For {helper}. Writing pieces needs no helper; only the guide does.
import { fill, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { innerAria } from "../parts/inner-button.js";
import { createDidLine } from "../parts/did-line.js";
import { STAGE_BADGES, coverageText, dateText, eraseSummary, gapLines, groupLibrary, guideCard, pieceHash, spokenTime, voiceHash, voiceProblem, wordsText } from "../parts/voice-rules.js";
import { clearVoiceCopies } from "../parts/voice-copies.js";
import { voiceGuideOf } from "../parts/helper-context-rules.js";

export async function createVoiceHub(context) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "content-card", "dropdown-menu", "empty-state", "modal-dialog", "skeleton-block", "status-badge");
  const heading = h("h2", { id: "studio-voice-h", class: "studio-question", tabindex: "-1", text: say("voice.title") });
  const more = h("dropdown-menu", { label: say("voice.more"), items: [{ value: "erase", label: say("voice.eraseAll") }], onItemselect: (event) => { if (event.detail === "erase") erase(); } });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const primary = h("div", { class: "studio-voice-primary" });
  const summary = h("p", { class: "studio-meta" });
  const guide = h("section", { class: "studio-section studio-voice-guide-card", "aria-labelledby": "studio-voice-guide-h" });
  const sets = h("div", { class: "studio-voice-sets", "aria-busy": "true" }, h("skeleton-block", { lines: 3 }), h("skeleton-block", { lines: 3 }));
  const said = createDidLine();
  const detailsBody = h("div", { class: "studio-voice-where" });
  const details = h("details", { class: "studio-voice-details", hidden: true }, h("summary", { text: say("common.forHelper") }), detailsBody);
  const element = h("section", { class: "studio-page studio-voice-hub", "aria-labelledby": "studio-voice-h" },
    h("div", { class: "studio-voice-top" }, h("breadcrumb-trail", { items: [{ label: say("voice.home"), href: "#/" }, { label: say("voice.title"), href: "" }] }), more),
    heading, h("p", { class: "studio-lede", text: say("voice.lede") }),
    banner, primary, summary, said.element, guide, sets, details);

  const writeButton = (label = say("voice.writeOne"), href = voiceHash()) => h("action-button", { href, size: "lg", class: "studio-primary" }, label);
  const forHelper = (...lines) => h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), ...lines.filter(Boolean).map((line) => h("p", { class: "studio-mono", text: String(line) })));

  function paintGuide(status, catalog, samples) {
    const descriptor = voiceGuideOf(catalog || {});
    const broken = !descriptor && (catalog?.voiceGuides || []).some((doc) => doc?.contextType === "voice" && doc.exists === true && doc.valid === false);
    const card = guideCard(status, descriptor, samples, { broken });
    const title = h("h3", { id: "studio-voice-guide-h", text: say("voice.guideCardHeading") });
    const tell = () => h("p", { class: "studio-help", text: say("common.tell") });
    switch (card.state) {
      case "helper-off": fill(guide, title, h("p", { text: say("voice.guideHelperOff") }), tell(), h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("a", { class: "studio-more-link", href: "#/helper?setup=1", text: say("voice.setUpHelper") }))); break;
      case "needs-pieces": fill(guide, title, h("p", { text: say("voice.guideNeedsPieces") })); break;
      case "broken": fill(guide, title, h("p", { text: say("voice.guideBroken") }), tell()); break;
      case "has": fill(guide, title, h("p", { text: say("voice.guideHas") }), h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", href: "#/voice/guide" }, say("voice.guideUpdate")), h("action-button", { variant: "ghost", href: "#/voice/guide?read=1" }, say("voice.guideRead")))); break;
      default: fill(guide, title, h("p", { text: say("voice.guideNone") }), h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", href: "#/voice/guide" }, say("voice.guideMake"))));
    }
  }

  function row(entry) {
    const title = String(entry.title || "");
    const badges = entry.badges.map((stage) => h("status-badge", { variant: stage === "polished" ? "success" : "neutral" },
      h("span", { "aria-hidden": "true", text: `${STAGE_BADGES[stage].symbol} ` }), stage === "polished" ? say("voice.badgePolished") : stage === "spoken" ? say("voice.badgeSpoken") : say("voice.badgeRough")));
    const openButton = h("action-button", { variant: "secondary", href: pieceHash(entry.id) }, say("voice.openRow"));
    innerAria(openButton, { "aria-label": say("voice.openRowName", { title }) });
    return h("li", { class: "studio-voice-row" },
      h("div", { class: "studio-voice-row-text" },
        h("strong", { class: "studio-voice-row-title", text: title }),
        h("span", { class: "studio-voice-badges" }, ...badges),
        h("span", { class: "studio-meta", text: [wordsText(entry.words), dateText(entry.date)].filter(Boolean).join(" · ") })),
      openButton);
  }

  function setSection(group, { other = false } = {}) {
    const id = `studio-voice-set-${group.id}`;
    const name = other ? say("voice.otherSet") : String(group.title || group.id);
    return h("section", { class: "studio-section studio-voice-set", "aria-labelledby": id, "data-set": group.id },
      h("h3", { id, text: name }),
      other ? h("p", { class: "studio-help", text: say("voice.otherSetHelp") }) : h("p", { class: "studio-meta", text: group.coverage }),
      group.rows.length ? h("ul", { class: "studio-voice-rows" }, group.rows.map(row)) : null,
      !other && group.unwritten > 0 && group.rows.length ? h("div", { class: "studio-row" }, h("action-button", { variant: "ghost", href: voiceHash(group.id) }, say("voice.morePack", { pack: name }))) : null);
  }

  function paintDetails(listing, status) {
    const rows = (listing.samples || []).map((file) => {
      const place = file.visibility === "portable" ? say("voice.wherePortable", { path: String(file.path || "") }) : say("voice.wherePrivate", { path: String(file.path || "") });
      return h("li", { class: "studio-mono", text: say("voice.fileLine", { where: place, bytes: Number(file.bytes) || 0, revision: String(file.revision || "—").slice(0, 12) }) });
    });
    fill(detailsBody,
      rows.length ? h("p", { class: "studio-help", text: say("voice.detailsFiles") }) : null,
      rows.length ? h("ul", { class: "studio-voice-files" }, rows) : null,
      ...(listing.warnings || []).map((warning) => h("p", { class: "studio-help", text: say("voice.catalogWarning", { warning: String(warning) }) })),
      status?.session?.open ? h("p", { class: "studio-mono", text: say("voice.sessionFile", { path: ".openblog/private/voice/session.json" }) }) : null,
      h("p", { class: "studio-help", text: say("voice.cli") }));
    details.hidden = false;
  }

  async function load() {
    fill(banner);
    let status;
    let listing;
    try {
      status = await api.get("voice/status");
      listing = await api.get("voice/samples");
    } catch (error) {
      if (error?.status === 401) throw error;
      sets.removeAttribute("aria-busy");
      fill(primary, writeButton());
      fill(guide);
      const problem = voiceProblem(error);
      fill(sets, problem.signal
        ? h("alert-banner", { variant: "info" }, say("voice.noSignalList"))
        : h("alert-banner", { variant: "danger", heading: say("voice.loadFailed") }, forHelper(`${problem.code}: ${problem.details}`),
          h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      return;
    }
    // The guide card only: neither failing hides her pieces.
    const [helper, catalog] = await Promise.all([api.get("assistant/status").catch(() => null), api.get("assistant/context?content=none").catch(() => null)]);
    const library = groupLibrary(listing);
    const session = status.session || {};
    const title = String(session.promptTitle || "");

    if (session.open && session.unreadable) {
      fill(primary, h("alert-banner", { variant: "warning" }, h("p", { text: say("voice.sessionStuck") }), h("p", { class: "studio-help", text: say("common.tell") }), forHelper(".openblog/private/voice/session.json")));
    } else if (session.open && session.expired) {
      fill(primary, h("content-card", { heading: say("voice.inProgressDone", { title }) }, h("action-button", { href: voiceHash(), size: "lg", class: "studio-primary" }, say("voice.seeIt"))));
    } else if (session.open) {
      fill(primary, h("content-card", { heading: say("voice.inProgress", { title, time: spokenTime(session.remainingSeconds) }) }, writeButton(say("voice.continue"))));
    } else if (!library.empty) {
      fill(primary, writeButton());
    } else {
      fill(primary);
    }

    const notices = [];
    const warning = catalog?.privateSafety?.warning;
    if (warning) notices.push(h("alert-banner", { variant: "warning" }, h("p", { text: say("voice.notPrivate") }), h("p", { class: "studio-help", text: say("common.tell") }), forHelper(warning)));
    if (library.invalid.length) {
      notices.push(h("alert-banner", { variant: "warning" }, h("p", { text: say("voice.unreadable") }), h("p", { class: "studio-help", text: say("common.tell") }),
        forHelper(...library.invalid.map((file) => say("voice.unreadableFile", { file: String(file.file), guidance: String(file.guidance || "") })))));
    }
    fill(banner, ...notices);

    summary.textContent = library.empty ? "" : library.polished
      ? say("voice.summary", { written: `${library.written} written`, polished: library.polished })
      : say("voice.summaryNone", { written: `${library.written} written` });
    paintGuide(helper, catalog, listing.samples || []);

    sets.removeAttribute("aria-busy");
    if (library.empty && !session.open) {
      fill(sets, h("empty-state", { heading: say("voice.emptyHeading") }, say("voice.emptyText"), h("action-button", { slot: "actions", href: voiceHash(), size: "lg" }, say("voice.writeOne"))));
    } else {
      const gaps = gapLines(listing.gaps, listing.coverage || []);
      const packs = gaps.find((line) => line.kind === "packs");
      const roughOnly = gaps.find((line) => line.kind === "rough-only");
      fill(sets,
        ...library.groups.filter((group) => group.rows.length).map((group) => setSection(group)),
        library.other ? setSection(library.other, { other: true }) : null,
        packs || roughOnly ? h("section", { class: "studio-section", "aria-labelledby": "studio-voice-notyet" },
          h("h3", { id: "studio-voice-notyet", text: say("voice.notYetHeading") }),
          packs ? h("p", { text: say("voice.notYet", { packs: packs.items.join(", ") }) }) : null,
          roughOnly ? h("p", { text: say("voice.roughOnly", { prompts: roughOnly.items.join(", ") }) }) : null) : null);
    }
    paintDetails(listing, status);
  }

  // ---- erase everything: asked once, in a dialog that lists what goes (R9 decision 2)
  async function erase() {
    said.tell(say("voice.eraseChecking"));
    let plan;
    try {
      plan = await api.get("voice/erase");
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(`${say("voice.eraseFailed")} ${voiceProblem(error).words}`, { variant: "problem" });
      return;
    }
    said.clear();
    const what = eraseSummary(plan);
    if (!what.files) { toast(say("voice.eraseNothing")); return; }
    await use("modal-dialog");
    const answer = await new Promise((resolve) => {
      let answered = false;
      const done = (value) => { answered = true; dialog.open = false; dialog.remove(); resolve(value); };
      const dialog = h("modal-dialog", { label: say("voice.eraseHeading"), class: "studio-dialog" },
        h("span", { slot: "heading", text: say("voice.eraseHeading") }),
        h("p", { text: say("voice.eraseText", { what: what.what }) }),
        h("p", { text: say("voice.eraseCopies") }),
        h("details", { class: "studio-help" }, h("summary", { text: `${say("common.forHelper")}: ${say("voice.eraseFiles", { n: what.files })}` }),
          h("ul", { class: "studio-voice-files" }, what.items.map((item) => h("li", { class: "studio-mono", text: say("voice.eraseFile", { path: item.path, kind: item.kind }) })))),
        h("action-button", { slot: "actions", variant: "secondary", onClick: () => done(false) }, say("voice.eraseNo")),
        h("action-button", { slot: "actions", variant: "destructive", onClick: () => done(true) }, say("voice.eraseYes")));
      dialog.addEventListener("openchange", (event) => { if (!event.detail && !answered) { dialog.remove(); resolve(false); } });
      document.body.append(dialog);
      dialog.open = true;
      // Keep it is the safe answer: it has focus.
      requestAnimationFrame(() => dialog.querySelector("action-button .action-button")?.focus());
    });
    if (!answer) { more.querySelector("button")?.focus(); return; }
    said.tell(say("voice.erasing"));
    try {
      // The server's own word, never typed by her; its all-or-nothing rule and re-check are unchanged.
      const report = await api.post("voice/erase", { confirm: plan.confirm });
      clearVoiceCopies();
      said.clear();
      if (report.clean) toast(say("voice.erased"));
      await load();
      if (!report.clean) {
        banner.prepend(h("alert-banner", { variant: "danger" }, h("p", { text: say("voice.erasePartial") }), h("p", { class: "studio-help", text: say("common.tell") }), forHelper(...(report.remaining || []).map(String))));
      }
      heading.focus();
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = voiceProblem(error);
      said.tell(`${say("voice.eraseFailed")} ${problem.words}`.trim(), { variant: "problem" });
      if (problem.details) said.element.append(forHelper(`${problem.code}: ${problem.details}`));
    }
  }

  return {
    title: say("voice.title"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    palette: [{ id: "voice-write", label: say("voice.findWrite"), group: "This screen", href: voiceHash() }, { id: "voice-erase", label: say("voice.eraseAll"), group: "This screen" }],
    command: (id) => { if (id === "voice-erase") erase(); },
  };
}

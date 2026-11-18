// About your blog after the questions (ONB1): the summary that saves, the site changes the answers
// suggest (each applied only on its own press, with the exact change for {helper}), and the offer
// to learn how she writes. Each fills the frame welcome.js gives it.
import { fill, h, toast } from "./dom.js";
import { say } from "./words.js";
import { innerAria } from "./inner-button.js";
import { AREA_IDS, areaName } from "./area-rules.js";
import { areasFor, savePatch, welcomeHash } from "./welcome-rules.js";
import { reasonText } from "./welcome-text.js";

export async function createWelcomeAfter(context, step, frame) {
  if (step === "summary") return summary(context, frame);
  if (step === "suggestions") return suggestions(context, frame);
  return voiceOffer(context, frame);
}

// ---- the summary

function summary(context, frame) {
  const { meta } = context;
  const answers = frame.answers;
  frame.heading(say("welcome.summaryHeading"));
  const result = areasFor(answers, meta.areas?.inUse || []);
  const status = h("p", { class: "studio-help", role: "status" });
  const line = (id, shown) => {
    const name = areaName(id);
    const reason = result.reasons[id];
    const change = reason.question ? h("a", { class: "studio-welcome-change-link", href: welcomeHash(reason.question, answers), text: say("welcome.change") }) : null;
    if (change) change.setAttribute("aria-label", say("welcome.changeName", { area: name }));
    return h("li", { class: "studio-welcome-line" },
      h("span", { class: "studio-welcome-line-text" },
        h("span", { "aria-hidden": "true", text: shown ? "✓ " : "– " }),
        h("span", { class: "studio-visually-hidden", text: `${shown ? say("welcome.markShown") : say("welcome.markTucked")}: ` }),
        h("strong", { text: name }), " ",
        h("span", { class: "studio-help", text: reasonText(reason, answers) })),
      change);
  };
  const shown = AREA_IDS.filter((id) => result.shown.includes(id));
  const tucked = AREA_IDS.filter((id) => result.hidden.includes(id));
  fill(frame.host,
    h("section", { class: "studio-section", "aria-labelledby": "studio-welcome-shown" },
      h("h3", { id: "studio-welcome-shown", text: say("welcome.shownHeading") }),
      h("ul", { class: "studio-welcome-lines" }, shown.map((id) => line(id, true)))),
    tucked.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-welcome-tucked" },
      h("h3", { id: "studio-welcome-tucked", text: say("welcome.tuckedHeading") }),
      result.showEverything ? h("p", { class: "studio-help", text: say("welcome.everythingNote") }) : null,
      h("ul", { class: "studio-welcome-lines" }, tucked.map((id) => line(id, false))),
      h("p", { class: "studio-help", text: say("welcome.tuckedNote") })) : null,
    h("p", { class: "studio-help", text: say("welcome.always") }),
    h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
      h("p", { class: "studio-mono", text: JSON.stringify(savePatch(answers, meta.areas?.inUse || [])) })),
    status);
  const save = h("action-button", { onClick: async () => {
    save.loading = true;
    status.textContent = say("welcome.saving");
    const saved = await context.areas.save(savePatch(answers, meta.areas?.inUse || []));
    save.loading = false;
    if (!saved.ok) {
      if (saved.code === "stale") {
        status.textContent = say("welcome.changedElsewhere");
        frame.go("summary", meta.areas?.answers || {});
        return;
      }
      status.textContent = saved.code === "no-signal" ? say("welcome.noSignal") : say("welcome.notSaved");
      return;
    }
    toast(say("welcome.saved"));
    frame.go("suggestions");
  } }, say("welcome.save"));
  frame.bar(save);
}

// ---- suggestions

/** Each suggestion's words and, for a screen, its button (literal ids). */
const SUGGESTION_WORDS = {
  "docs-section": () => [say("welcome.s.docsSection"), say("welcome.s.docsSectionAbout"), ""],
  "recipe-list": () => [say("welcome.s.recipeList"), say("welcome.s.recipeListAbout"), ""],
  business: () => [say("welcome.s.business"), say("welcome.s.businessAbout"), say("welcome.s.businessGo")],
  seasons: () => [say("welcome.s.seasons"), say("welcome.s.seasonsAbout"), say("welcome.s.seasonsGo")],
  readers: () => [say("welcome.s.readers"), say("welcome.s.readersAbout"), say("welcome.s.readersGo")],
  sharing: () => [say("welcome.s.sharing"), say("welcome.s.sharingAbout"), say("welcome.s.sharingGo")],
};

async function suggestions(context, frame) {
  const { api } = context;
  frame.heading(say("welcome.suggestHeading"));
  fill(frame.host, h("skeleton-block", { lines: 4 }));
  frame.bar(null);
  let found;
  try {
    found = await api.post("areas/suggestions", { kind: frame.answers.kind || "", answers: frame.answers });
  } catch (error) {
    if (error?.status === 401) throw error;
    fill(frame.host, h("alert-banner", { variant: "info" }, say("welcome.suggestLoadFailed")));
    frame.bar(h("action-button", { onClick: () => frame.go("voice") }, say("welcome.next")));
    return;
  }
  const known = (found.suggestions || []).filter((s) => SUGGESTION_WORDS[s.id]);
  if (!known.length || frame.practice) {
    // Nothing to suggest (or a practice run, which changes nothing of the site's): on to the offer.
    context.replaceRoute?.(welcomeHash("voice", frame.answers));
    return voiceOffer(context, frame);
  }
  let etag = found.etag || "";
  const cards = known.map((suggestion) => card(suggestion));
  function card(suggestion) {
    const [title, about, go] = SUGGESTION_WORDS[suggestion.id]();
    const said = h("p", { class: "studio-help", role: "status" });
    const body = [h("p", { text: about })];
    let button = null;
    if (suggestion.type === "change") {
      button = h("action-button", { variant: "secondary", onClick: async () => {
        button.loading = true;
        said.textContent = say("welcome.applying");
        try {
          const applied = await api.post("areas/suggestions/apply", { id: suggestion.id, etag });
          etag = applied.etag || etag;
          said.textContent = say("welcome.applied");
          button.remove();
        } catch (error) {
          if (error?.status === 401) throw error;
          button.loading = false;
          if (error?.data?.code === "stale") {
            said.textContent = say("welcome.suggestStale");
            try { etag = (await api.post("areas/suggestions", { kind: frame.answers.kind || "", answers: frame.answers })).etag || etag; } catch { /* the next press says so */ }
          } else if (error?.data?.code === "already") {
            said.textContent = say("welcome.applied");
            button.remove();
          } else {
            said.textContent = say("welcome.suggestFailed");
          }
        }
      } }, say("welcome.doThis"));
      innerAria(button, { "aria-label": say("welcome.doThisName", { what: title }) });
      body.push(h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
        h("p", { text: say("welcome.exactChange", { member: String(suggestion.member || "") }) }),
        h("pre", { class: "studio-mono studio-welcome-change", text: (suggestion.lines || []).map((l) => `${l.op === "-" ? "-" : "+"} ${l.text}`).join("\n") })));
    } else {
      button = h("action-button", { variant: "secondary", href: String(suggestion.href || "#/") }, go);
    }
    return h("content-card", { heading: title }, ...body, button, said);
  }
  fill(frame.host, h("p", { class: "studio-lede", text: say("welcome.suggestLede") }), ...cards);
  frame.bar(h("action-button", { onClick: () => frame.go("voice") }, say("welcome.next")));
}

// ---- the voice offer

async function voiceOffer(context, frame) {
  const { api, meta } = context;
  frame.heading(say("welcome.voiceHeading"));
  let samples = 0;
  try {
    samples = Number((await api.get("voice/status")).samples) || 0;
  } catch (error) {
    if (error?.status === 401) throw error;
  }
  fill(frame.host,
    h("p", { class: "studio-lede", text: say("welcome.voiceLede") }),
    h("p", { text: say("welcome.voiceStory") }),
    samples === 1 ? h("p", { class: "studio-help", text: say("welcome.voiceHasOne") }) : samples > 1 ? h("p", { class: "studio-help", text: say("welcome.voiceHas", { n: samples }) }) : null);
  const run = meta.onboarding && (meta.onboarding.due === true || meta.onboarding.resume === true);
  /** A due Getting started run: later (it waits, Home has its card) or skipped. Quiet when it fails. */
  async function settleRun(change) {
    if (!run) return;
    try {
      const practice = meta.onboarding.practice === true;
      const extra = practice ? { practice: true } : {};
      const info = await api.get("onboarding");
      let etag = info.etag || "";
      if (!info.record) etag = (await api.put("onboarding", { etag, total: info.needsKey ? 3 : 2, ...extra })).etag || "";
      await api.put("onboarding", { etag, ...change, ...extra });
      await context.refreshMeta?.();
    } catch (error) {
      if (error?.status === 401) throw error;
    }
  }
  const later = h("action-button", { variant: "ghost", onClick: async () => {
    later.loading = true;
    await settleRun({ lastAutoOpen: true });
    toast(say("welcome.voiceLaterToast"));
    context.go("#/");
  } }, say("welcome.voiceLater"));
  const no = h("action-button", { variant: "ghost", onClick: async () => {
    no.loading = true;
    try { await api.post("voice/invitation", { dismissed: true }); } catch (error) { if (error?.status === 401) throw error; }
    await settleRun({ status: "skipped" });
    toast(say("welcome.voiceNoToast"));
    context.go("#/");
  } }, say("welcome.voiceNo"));
  frame.bar(h("action-button", { href: "#/start" }, say("welcome.voiceStart")), [no, later]);
}

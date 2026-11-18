// My stories (ONB1.7.4, #/stories): "Which true stories have I told, so I can reach for one?"
// Her stories, newest first, each with Read it and Start a post from this; Write another story;
// and, closed, her other pieces with Add to my stories. Private: nothing here is ever put up.
// Reached from Your writing voice, Write's Stories you could tell, Getting started and Find.
import { fill, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { innerAria } from "../parts/inner-button.js";
import { loadStories, postFromStory, storyRow, storyText } from "../parts/story-list.js";
import { marksAfter, storyTitle } from "../parts/story-list-rules.js";
import { wordsText } from "../parts/voice-rules.js";
import { createSheet } from "../parts/sheet.js";

export async function createStories(context) {
  const { api, meta } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "empty-state", "skeleton-block");
  const heading = h("h2", { id: "studio-stories-h", class: "studio-question", tabindex: "-1", text: say("stories.heading") });
  const list = h("div", { class: "studio-stories", "aria-busy": "true" }, h("skeleton-block", { lines: 3 }), h("skeleton-block", { lines: 3 }));
  const said = h("p", { class: "studio-help", role: "status" });
  const element = h("section", { class: "studio-page studio-stories-page", "aria-labelledby": "studio-stories-h" },
    h("breadcrumb-trail", { items: [{ label: say("voice.home"), href: "#/" }, { label: say("voice.title"), href: "#/voice" }, { label: say("stories.title"), href: "" }] }),
    heading, h("p", { class: "studio-lede", text: say("stories.lede") }),
    h("div", { class: "studio-row" }, h("action-button", { href: "#/voice/write?pack=stories", size: "lg", class: "studio-primary" }, say("stories.another"))),
    said, list);
  const reader = await createSheet({ label: say("stories.title"), wide: false });
  let found = { stories: [], others: [], samples: [] };

  async function start(story, button, line) {
    button.loading = true;
    line.textContent = say("stories.making");
    try {
      const href = await postFromStory(api, story, found.samples);
      line.textContent = say("stories.made");
      toast(say("stories.made"), { action: { label: say("stories.openPost"), href } });
      context.go(href);
    } catch (error) {
      if (error?.status === 401) throw error;
      line.textContent = say("stories.makeFailed");
    } finally {
      button.loading = false;
    }
  }

  function read(story, opener) {
    reader.show({ heading: storyTitle(story), opener, children: [storyText(story)], focus: () => reader.element.querySelector(".studio-story-text")?.focus() });
  }

  async function mark(piece, add, button) {
    button.loading = true;
    const saved = await context.areas.save({ storyMarks: marksAfter(meta.areas?.storyMarks, piece.id, add) });
    button.loading = false;
    if (!saved.ok && saved.code !== "stale") { said.textContent = say("stories.markFailed"); return; }
    said.textContent = add ? say("stories.added") : say("stories.removed");
    await load();
  }

  function paint() {
    list.removeAttribute("aria-busy");
    const rows = found.stories.map((story) => {
      const extra = [];
      if (story.marked) {
        const out = h("action-button", { variant: "ghost", onClick: () => mark(story, false, out) }, say("stories.remove"));
        innerAria(out, { "aria-label": say("stories.removeName", { title: storyTitle(story) }) });
        extra.push(out);
      }
      return storyRow(story, { onRead: read, onStart: start, extra });
    });
    const others = found.others.map((piece) => {
      const add = h("action-button", { variant: "secondary", onClick: () => mark(piece, true, add) }, say("stories.add"));
      innerAria(add, { "aria-label": say("stories.addName", { title: storyTitle(piece) }) });
      return h("li", { class: "studio-story-row" }, h("strong", { text: storyTitle(piece) }), h("span", { class: "studio-meta", text: wordsText(piece.words) }), add);
    });
    fill(list,
      rows.length ? h("ul", { class: "studio-story-list" }, rows)
        : h("empty-state", { heading: say("stories.empty") }, h("action-button", { slot: "actions", href: "#/voice/write?pack=stories" }, say("stories.writeFirst"))),
      others.length ? h("details", { class: "studio-help studio-story-others" }, h("summary", { text: say("stories.others") }),
        h("p", { text: say("stories.othersHelp") }), h("ul", { class: "studio-story-list" }, others)) : null);
  }

  async function load() {
    try {
      found = await loadStories(api, api.user, meta.areas?.storyMarks || []);
    } catch (error) {
      if (error?.status === 401) throw error;
      list.removeAttribute("aria-busy");
      fill(list, h("alert-banner", { variant: "danger" }, h("p", { text: say("stories.loadFailed") }),
        h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      return;
    }
    paint();
  }

  return { title: say("stories.title"), element, load, focus: () => heading.focus(), leave: () => reader.leave() };
}

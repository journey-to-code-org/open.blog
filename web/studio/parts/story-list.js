// Her stories as a list (ONB1.7.4), shared by My stories (#/stories) and Write's Stories you
// could tell: each with its title, its first words, how long it is and when; Read it; and Start a
// post from this, which makes a word-for-word polished copy when there isn't one and then R9's
// make-a-post. The story itself is never edited. Words are placed as text, never markup.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { innerAria } from "./inner-button.js";
import { dateText, wordsText } from "./voice-rules.js";
import { opening, polishedOf, storiesFrom, storyTitle } from "./story-list-rules.js";

/** Her stories and other pieces, with each story's words. `{ stories, others, samples }`. */
export async function loadStories(api, user, marks = []) {
  const listing = await api.get("voice/samples");
  const samples = listing.samples || [];
  const found = storiesFrom(samples, marks, user);
  // The first words of each story (the newest few dozen; a long list loads its words as needed).
  await Promise.all(found.stories.slice(0, 40).map(async (story) => {
    try {
      const one = await api.get(`voice/samples/${encodeURIComponent(story.id)}`);
      story.body = String(one.body || "");
    } catch (error) {
      if (error?.status === 401) throw error;
      story.body = "";
    }
  }));
  return { ...found, samples };
}

/**
 * Make a draft post from a story: its polished copy (made word for word first when there is none),
 * then R9's make-a-post. Resolves to the new post's Write address.
 */
export async function postFromStory(api, story, samples) {
  let polished = polishedOf(samples, story);
  if (!polished) {
    let body = story.body;
    if (body === undefined) body = String((await api.get(`voice/samples/${encodeURIComponent(story.id)}`)).body || "");
    polished = await api.post("voice/samples", { roughOf: story.file, title: String(story.title || storyTitle(story)), body });
  }
  const made = await api.post(`voice/samples/${encodeURIComponent(polished.id)}/promote`, {});
  return `#/write/${encodeURIComponent(String(made.editPath || ""))}`;
}

/**
 * One story's row. `onRead(story, button)` shows it; `onStart(story, button, said)` makes a post;
 * `extra` are more buttons (Take out of my stories).
 */
export function storyRow(story, { onRead, onStart, extra = [] }) {
  const title = storyTitle(story);
  const said = h("p", { class: "studio-help", role: "status" });
  const read = h("action-button", { variant: "secondary", onClick: () => onRead(story, read) }, say("stories.read"));
  innerAria(read, { "aria-label": say("stories.readName", { title }) });
  const start = h("action-button", { variant: "secondary", onClick: () => onStart(story, start, said) }, say("stories.startPost"));
  innerAria(start, { "aria-label": say("stories.startPostName", { title }) });
  const first = opening(story.body);
  return h("li", { class: "studio-story-row" },
    h("strong", { class: "studio-story-title", text: title }),
    first ? h("p", { class: "studio-story-opening", text: first }) : null,
    h("p", { class: "studio-meta", text: say("stories.row", { words: wordsText(story.words), date: dateText(story.date) }) }),
    h("div", { class: "studio-row" }, read, start, ...extra),
    said);
}

/** A story's words, read-only, as she told them. */
export function storyText(story) {
  const title = storyTitle(story);
  const region = h("div", { class: "studio-story-text", role: "region", tabindex: "0", "aria-label": say("stories.readRegion", { title }) });
  fill(region, h("bdi", { text: String(story.body || "") }));
  return region;
}

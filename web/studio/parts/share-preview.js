// "How it looks on Bluesky": what each account will make of her words, asked of Admin's own
// `social/preview` 350 ms after she stops typing (one call per kind of account). Problems the
// server finds go on their field by `fieldForCode`; the notes are said plainly. Used by Change
// this share and Share a post (R1). Her words are only ever text.
import { h } from "./dom.js";
import { blueskyNotes, mastodonNotes, fieldForCode } from "./announcements-rules.js";
import { providerName } from "./share-words.js";

const DELAY_MS = 350;

/**
 * `read()` gives { providers, caption, work, scheduledFor, timeZone }; `onProblems(byField)` gets
 * { caption?, time?, post? } with the server's codes, so the screen says them in its own words.
 */
export function createSharePreview({ api, read, onProblems = () => {} }) {
  const element = h("div", { class: "studio-share-preview" });
  let timer = null;
  let turn = 0;
  let last = null;

  async function run() {
    const mine = ++turn;
    const { providers, caption, work, scheduledFor, timeZone } = read();
    const kinds = [...new Set(providers)].filter(Boolean);
    if (!kinds.length || !work) { element.replaceChildren(); return; }
    const replies = [];
    for (const provider of kinds) {
      try {
        replies.push({ provider, reply: await api.post("social/preview", { provider, caption, work, ...(scheduledFor ? { scheduledFor } : {}), timeZone }) });
      } catch (error) {
        if (error.status === 401) throw error;
        replies.push({ provider, reply: null });
      }
    }
    if (mine !== turn) return;
    last = replies;
    const byField = {};
    for (const { reply } of replies) {
      for (const problem of reply?.problems || []) {
        const field = problem.field === "scheduledFor" ? "time" : problem.field === "work" ? "post" : fieldForCode(problem.code);
        byField[field] ||= problem.code;
      }
    }
    onProblems(byField);
    element.replaceChildren(...replies.map(({ provider, reply }) => {
      const name = providerName(provider);
      const notes = !reply ? ["Studio couldn't show this just now. It will still share as you wrote it."]
        : provider === "bluesky" ? blueskyNotes(caption, reply.link, reply.card)
          : provider === "mastodon" ? mastodonNotes(caption, reply.link, reply.cover)
            : [`On ${name} the link to your post goes with it.`];
      return h("details", { class: "studio-help studio-share-look" },
        h("summary", { text: `How it looks on ${name}` }),
        h("p", { class: "studio-share-caption", text: caption.trim() }),
        reply?.link ? h("p", { class: "studio-mono", text: reply.link }) : null,
        notes.length ? h("ul", {}, ...notes.map((note) => h("li", { text: note }))) : null);
    }));
  }

  return {
    element,
    /** Ask again once she stops typing. */
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => run().catch(() => {}), DELAY_MS);
    },
    now: () => run(),
    stop() { clearTimeout(timer); turn += 1; },
    get last() { return last; },
  };
}

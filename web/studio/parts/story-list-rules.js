// My stories (ONB1.7.4): which pieces of her writing are stories, in what order, and how a row
// reads. A story is a rough piece from the Stories, People or Getting started sets, or one she
// added herself (`storyMarks` in her preferences). Pure: no page, no network, no storage.

/** The sets whose pieces are true stories from her life. */
export const STORY_SETS = Object.freeze(["stories", "people", "getting-started"]);

/** Whether a listed piece is hers to see here: written by her, or by nobody named (older pieces). */
const hers = (piece, user) => !piece.by || !user || piece.by === user;

/**
 * Her stories and the rest of her rough pieces: `{ stories, others }`, each newest first. `samples`
 * is `voice/samples`' list; `marks` her `storyMarks`; `user` who is signed in.
 */
export function storiesFrom(samples = [], marks = [], user = "") {
  const marked = new Set(Array.isArray(marks) ? marks : []);
  const rough = (Array.isArray(samples) ? samples : []).filter((p) => p && p.valid && p.stage === "rough" && typeof p.id === "string" && hers(p, user));
  const newest = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id).localeCompare(String(a.id));
  const isStory = (p) => STORY_SETS.includes(p.pack) || marked.has(p.id);
  return {
    stories: rough.filter(isStory).sort(newest).map((p) => ({ ...p, marked: marked.has(p.id) && !STORY_SETS.includes(p.pack) })),
    others: rough.filter((p) => !isStory(p)).sort(newest),
  };
}

/** A story's title: the question it answered, else its own. */
export const storyTitle = (piece = {}) => String(piece.promptTitle || piece.title || "");

/** The first words of a story, for its row ("It was the first time we…"). */
export function opening(body = "", count = 14) {
  const words = String(body || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return "";
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
}

/** The polished copy of a rough piece, when there is one. */
export function polishedOf(samples = [], rough = {}) {
  return (Array.isArray(samples) ? samples : []).find((p) => p && p.valid && p.stage === "polished" && p.roughOf === rough.file) || null;
}

/** `storyMarks` after adding or taking out one piece. */
export function marksAfter(marks = [], id, add) {
  const now = (Array.isArray(marks) ? marks : []).filter((m) => m !== id);
  return add ? [...now, id] : now;
}

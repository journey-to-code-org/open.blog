// What kind of post it is, and each kind's own facts, in her words. The engine's profiles come in
// `meta.profiles` (ids, keys, aliases, choices: G40); the labels and help here are Studio's own.
// A story and a job have no group in About this post (About this job is under the title). DOM-free.
import { say } from "./words.js";

/** Each kind as she hears it. */
export const KIND_WORDS = Object.freeze({
  article: { label: "A story", help: "Words and photos." },
  recipe: { label: "A recipe", help: "Ingredients and steps, with a recipe card." },
  job: { label: "A job", help: "Work you did for a customer." },
  video: { label: "A video", help: "A page to go with a video on YouTube." },
  "field-journal": { label: "A trip outdoors", help: "A walk, a paddle or a day in the field." },
  research: { label: "Research", help: "Writing with sources and references." },
});

const UNKNOWN = { label: "Something else", get help() { return `Your blog shows it as a story. ${say("common.chose")}`; } };

/**
 * The kinds she can choose: a story, a recipe, a job on a trade site, and the post's own kind when
 * it is another (a video stays offered on a video post). An unknown id is kept as "Something else".
 * @returns {{ value: string, label: string, help: string }[]}
 */
export function kindChoices(meta, current, { trade = false } = {}) {
  const known = new Set((meta?.profiles || []).map((p) => p.id));
  const ids = ["article", "recipe", ...(trade ? ["job"] : [])];
  if (current && !ids.includes(current)) ids.push(current);
  return ids.map((id) => ({ value: id, ...(KIND_WORDS[id] && (known.has(id) || !meta?.profiles) ? KIND_WORDS[id] : UNKNOWN) }));
}

/** "A recipe", "Something else": what the About this post line says about the kind. */
export const kindLabel = (id) => (KIND_WORDS[id] || UNKNOWN).label;

/**
 * Each kind's group on her layer, and the facts that sit in Details (for the person who set up
 * the site). `key` is the engine's; `control` "text" | "url" | "number" | "choice" | "picture" | "rows".
 */
export const PROFILE_GROUPS = Object.freeze({
  recipe: {
    heading: "This recipe",
    fields: [
      { key: "course", label: "Course", help: "Like Dessert or Dinner. Readers can find recipes by it.", helpNoList: "Like Dessert or Dinner." },
      { key: "cuisine", label: "Cuisine", help: "Where the dish comes from, like Southern or Italian." },
      { key: "yield", label: "Makes", help: "What it makes, like 2 loaves or 24 cookies." },
      { key: "totalTime", label: "Time from start to table", help: "Only when it's more than getting ready plus cooking, like an overnight rise." },
      { key: "calories", label: "Calories in a serving", help: "Only if you know, like 320.", inputmode: "numeric" },
      { key: "adaptedFrom", label: "Where you found it", help: "If it started as a recipe on another website, paste its web address. To thank a person, say so in your words.", control: "url" },
    ],
    details: [],
  },
  video: {
    heading: "This video",
    fields: [
      { key: "videoUrl", label: "YouTube link", help: "Copy it from Share under the video.", control: "url" },
      { key: "duration", label: "How long it is", help: "Like 12:34." },
      { key: "thumbnail", label: "Picture shown before it plays", help: "Leave empty to use the cover photo.", control: "picture" },
      { key: "productionStatus", label: "Where it's at", control: "choice", select: true, choices: { idea: "Idea", scripting: "Writing the script", storyboarding: "Storyboard", generating: "Making it", editing: "Editing", scheduled: "Scheduled", released: "Out" } },
      { key: "madeForKids", label: "Made for children?", help: "YouTube asks this of every video.", control: "choice", choices: { yes: "Yes", no: "No" } },
      { key: "syntheticMedia", label: "Anything realistic that was made up or changed?", help: "YouTube asks you to say so.", control: "choice", choices: { yes: "Yes", no: "No" } },
      { key: "videoPeople", label: "People in it", control: "choice", choices: { consented: "Everyone you can recognise said yes", none: "No one you can recognise" } },
      { key: "videoRights", label: "Rights", control: "choice", choices: { owned: "It's all mine", licensed: "I have permission for everything in it" } },
      { key: "aiDisclosure", label: "Help from AI", help: "A short note, in your words, if AI helped make it." },
    ],
    details: [
      { key: "videoFile", label: "Video master file", help: "In the project, outside the static folder, like media/episode-1.mp4." },
      { key: "captions", label: "Caption files", help: "Comma-separated, named for their language, like media/episode-1.en.vtt." },
      { key: "videoTitle", label: "YouTube title", help: "At most 100 letters. Leave empty to use the post's title.", max: 100 },
      { key: "videoDescription", label: "YouTube description", help: "Leave empty to use the summary.", control: "rows" },
      { key: "seasonNumber", label: "Season", control: "number" },
      { key: "episodeNumber", label: "Episode", control: "number" },
      { key: "productionCredits", label: "Production credits" },
    ],
  },
  "field-journal": {
    heading: "This trip outdoors",
    fields: [
      { key: "activity", label: "What you did", suggestions: ["Hike", "Paddle", "Field survey"] },
      { key: "location", label: "Where", help: "An area name that's safe to share, like the Dolly Sods. Never a home or a private spot." },
      { key: "locationPrivacy", label: "How much of the place readers see", control: "choice", start: "hidden", choices: { hidden: "Don't show it", approximate: "Just the area", trimmed: "The route without where it starts and ends", exact: "The exact route" } },
      { key: "distanceKm", label: "Distance (km)", help: "A number, like 4.2.", inputmode: "decimal" },
      { key: "elevationGainM", label: "Climb (m)", help: "A number, like 4.2.", inputmode: "decimal" },
      { key: "duration", label: "How long", help: "Like 2 hr 15 min." },
      { key: "conditions", label: "Conditions", help: "Weather, trail, water, what you saw.", control: "rows" },
    ],
    details: [],
  },
  research: {
    heading: "",
    fields: [],
    details: [
      { key: "doi", label: "DOI", help: "DOI name or https://doi.org/ link." },
      { key: "license", label: "License", help: "Full https:// address of the license.", control: "url" },
    ],
  },
});

/** The group for a kind, or null for a story, a job and any kind without its own facts. */
export function groupFor(kind) {
  const group = PROFILE_GROUPS[kind];
  return group && (group.fields.length || group.details.length) ? group : null;
}

/** Every key a kind's group shows (her layer and Details), for reading and saving. */
export function groupKeys(kind) {
  const group = PROFILE_GROUPS[kind];
  return group ? [...group.fields, ...group.details].map((f) => f.key) : [];
}

/** A choice's words; a value the post has that isn't one of them is shown as written. */
export function choiceLabel(field, value) {
  return field.choices?.[value] || value;
}

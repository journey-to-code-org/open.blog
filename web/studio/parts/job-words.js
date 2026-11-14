// What New job, the waiting cards and About this job say, in her words (Studio R4,
// docs/specs/studio/r4/ux.md). "This phone" is the phone in her hand (`deviceNoun`); nothing here
// says upload, sync, offline, queue, storage or capture. DOM-free and tested
// (tests/web/studio-job-words.test.mjs).
import { sayClock, sayWhen } from "./dates.js";

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const stem = (name) => String(name || "photo").replace(/\.[a-z0-9]{2,5}$/i, "");
const quoted = (name) => `“${name}”`;
const mb = (bytes) => Math.floor(bytes / (1024 * 1024));

/** "This iPhone", "This phone", "This computer". */
export const thisDevice = (noun = "phone") => `This ${noun}`;

/** Why a job couldn't be kept on this phone (`roomProblem` codes and `write`). The job stays on the screen. */
export function ROOM_WORDS(code, { limits = {}, noun = "phone", queued = 0, remove = 1 } = {}) {
  if (code === "maxQueued") return `${thisDevice(noun)} is already holding ${plural(queued || limits.maxQueued || 5, "job")} that haven't sent. This one stays here until they go.`;
  if (code === "maxCaptureBytes") return `This job has too many large photos to keep. Take out about ${remove}.`;
  if (code === "maxQueueBytes") return `The jobs waiting on this ${noun} are using all the room your blog has here. Send them first. This one stays here.`;
  if (code === "closed") return "Another window updated your blog's pages. Reload, then save again. This job stays here.";
  return `${thisDevice(noun)} is out of room to keep it. Free up some space, or send the waiting jobs first. This one stays here.`;
}

/** What's wrong with a photo she picked (`photoProblem` codes). */
export function PHOTO_WORDS(code, { name = "", limits = {} } = {}) {
  if (code === "not-photo") return `${quoted(name || "That file")} isn't a photo.`;
  if (code === "too-big") return `${quoted(stem(name))} is too big to use. The limit is ${mb(limits.maxPhotoBytes || 40 * 1024 * 1024)} MB a photo.`;
  return "";
}

/** Photos past the most a job holds. */
export function tooManyWords(names, max = 12) {
  const left = names.map(stem);
  return left.length === 1
    ? `A job holds up to ${max} photos, so this one wasn't added: ${left[0]}.`
    : `A job holds up to ${max} photos, so these ${left.length} weren't added: ${left.join(", ")}.`;
}

/** The voice note, by recorder state and by why it stopped. */
export const RECORD_WORDS = Object.freeze({
  idle: (maxSeconds = 180) => `Up to ${Math.round(maxSeconds / 60)} minutes.`,
  unsupported: "Voice notes don't work here. Type a few words instead.",
  starting: "Your phone may ask to use the microphone. Tap Allow.",
  unavailable: "The microphone didn't start. If another app is using it, close that app and try again. Or type a few words.",
  time: "Stopped at 3 minutes, the longest a voice note can be. It's kept.",
  size: "Stopped: that's as long as a voice note can be. It's kept.",
  error: "The recording stopped by itself. What you said up to then is kept.",
  empty: "Nothing was recorded.",
  left: "Your voice note stopped when you left. It's kept.",
  replace: "Replace your voice note?",
  thrown: "Your voice note is thrown away.",
  denied: (noun = "iPhone") => `Your blog isn't allowed to use the microphone on this ${noun}. To change that:`,
  deniedAfter: "Or type a few words instead.",
});

/** "1:12 long." */
export const lengthWords = (clockText) => `${clockText} long.`;

/** How to let her blog use the microphone again, for the phone in her hand only. */
export function micSteps(here = {}) {
  if (here.apple) {
    return ["Open the Settings app.", "Tap Apps, then Safari (on older iPhones, just Safari).", "Tap Microphone and choose Ask or Allow.", "Come back and tap Record again."];
  }
  if (here.android && here.standalone) return ["Touch and hold your blog's icon.", "Tap App info.", "Tap Permissions, then Microphone, then Allow."];
  if (here.android) return ["Tap the small icon at the left end of the address bar.", "Tap Permissions.", "Turn on Microphone."];
  return ["Click the small icon at the left end of the address bar and allow the microphone."];
}

/** "Camera won't open?", for the phone in her hand only. */
export function cameraHelp(here = {}) {
  if (here.apple) return "Tap Choose photos, then Take Photo. Or take them in the Camera app and choose them here after.";
  if (here.android) return "In the Settings app: Apps, then Chrome, then Permissions, then Camera, then Allow.";
  return "Use Choose photos to pick photos you've already taken.";
}

/** What a refused job's card says, by the refusal's code. */
export function refusedWords(code, noun = "phone") {
  if (code === "capture-id") return `This job's label got damaged on this ${noun}, so it can't be sent. Save its photos, then throw it away.`;
  if (code === "ledger-version") return "Your blog was updated in a way this page doesn't understand yet. Reload, then try again.";
  return "Your blog said no to this job. Tell the person who set up your site.";
}

/** "4 photos, voice note. Saved today at 11:40 AM." Never sizes. */
export function savedWords(record, now = new Date()) {
  const parts = [];
  if (record.photos.length) parts.push(plural(record.photos.length, "photo"));
  if (record.audio) parts.push("voice note");
  if (!parts.length) parts.push("Words only");
  const what = parts.join(", ");
  const when = sayWhen(record.createdAt, { now });
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}. Saved ${when ? when.charAt(0).toLowerCase() + when.slice(1) : "on this phone"}.`;
}

/**
 * A waiting card's badge, its words and the variant, by `entryState`. `live` is the sender's
 * knowledge in this window; `record` may be missing for one it can't read.
 */
export function waitingWords(state, { record = null, live = {}, step = "", now = new Date(), noun = "phone" } = {}) {
  const at = live.triedAt ? sayClock(live.triedAt.toISOString?.() ?? live.triedAt) : "";
  switch (state) {
    case "sending":
      return { badge: "Sending", variant: "info", words: live.elsewhere ? "Sending in another window…" : step || "Sending…" };
    case "tried": {
      const server = live.code === "server" || /^\[server\]/.test(record?.lastError || "");
      const lead = server ? "Your blog didn't answer when it last tried" : "No signal when it last tried";
      return { badge: "Waiting", variant: "neutral", words: `${lead}${at ? `, at ${at}` : ""}. It tries again by itself.` };
    }
    case "signin":
      return { badge: "Needs you", variant: "warning", words: "Sign in again to send it." };
    case "refused":
      return { badge: "Didn't send", variant: "danger", words: `${refusedWords(live.code || codeOf(record), noun)} Nothing is lost: it's still on this ${noun}.` };
    case "removed":
      return { badge: "Needs you", variant: "warning", words: "This job went to your blog before, and was deleted there since." };
    case "sent": {
      const skipped = record?.sent?.skipped || [];
      const photos = skipped.length
        ? `${plural(skipped.length, "photo")} couldn't go: ${skipped.map((name) => quoted(stem(name))).join(", ")} ${skipped.length === 1 ? "is" : "are"} in a format websites can't show.`
        : "";
      const voice = record?.sent?.audio === "refused" ? "the voice note couldn't be kept." : "";
      return { badge: "Sent", variant: "success", words: `It's a draft on your blog, but ${[photos, voice].filter(Boolean).join(" And ")}` };
    }
    case "someone-else":
      return { badge: "Needs you", variant: "warning", words: `Saved while ${record?.by || "someone else"} was signed in on this ${noun}.` };
    case "newer":
      return { badge: "Needs you", variant: "warning", words: "This job was saved by a newer version of your blog's pages. Reload to send it. If it still says this, tell the person who set up your site." };
    case "unreadable":
      return { badge: "Can't read", variant: "danger", words: `Part of this job can't be read on this ${noun}, so it can't be sent.` };
    default:
      return { badge: "Waiting", variant: "neutral", words: "It sends by itself when there's a signal." };
  }
}

const codeOf = (record) => /^\[([a-z0-9-]+)\]/.exec(String(record?.lastError || ""))?.[1] || "refused";

/** The name of a job that can't be read: "A job kept on this iPhone", then "(2)", "(3)"… so each card and its More are told apart. */
export const keptTitle = (index = 0, noun = "phone") => `A job kept on this ${noun}${index ? ` (${index + 1})` : ""}`;

/** A job waiting more than 5 days in a Safari tab. */
export const safariClearWords = (noun = "phone") => `Safari may clear jobs kept here if your blog isn't opened for a week. Send it, or save its photos to this ${noun}.`;

/** "2 jobs waiting on this iPhone". */
export const waitingCount = (count, noun = "phone") => `${plural(count, "job")} waiting on this ${noun}`;

/** The status line while sending and after. */
export function flushWords({ total = 0, done = 0, sent = 0, blocked = "", waiting = 0 } = {}) {
  if (total && done < total && !blocked) return `Sending ${done + 1} of ${plural(total, "job")}…`;
  if (blocked === "signin") return "Sign in again to send what's waiting.";
  if (waiting) return `${plural(waiting, "job")} ${waiting === 1 ? "is" : "are"} still waiting for a signal.`;
  if (sent) return "Sent.";
  return "";
}

/** "Sent. Roof repair in Elkins is a draft on your blog." */
export const sentWords = (title) => `Sent. ${title} is a draft on your blog.`;

const COMPANIES = { "open-ai": "OpenAI", openai: "OpenAI", anthropic: "Anthropic", google: "Google", gemini: "Google", mistral: "Mistral" };

/** The company a helper sends to, by name: "OpenAI", never an address or a model. */
export function companyName({ provider = "", destination = "" } = {}) {
  if (COMPANIES[String(provider).toLowerCase()]) return COMPANIES[String(provider).toLowerCase()];
  const text = String(destination || "").trim();
  try {
    const host = new URL(text).hostname.replace(/^(api|www)\./, "");
    const known = Object.entries(COMPANIES).find(([key]) => host.includes(key.replace("-", "")));
    return known ? known[1] : host;
  } catch {
    return text || "another company";
  }
}

/** Where the voice note goes to be turned into words: the place, never the model. */
export function transcribeDisclosure(disclosure = {}) {
  if (disclosure.engine === "local" || disclosure.leavesServer === false) return "Your blog turns it into words on its own computer. Nothing leaves it.";
  const where = companyName(disclosure);
  return `Your voice note goes to ${where} to be turned into words. Only the recording goes: not your photos or your notes. ${where}'s own rules cover what it keeps.`;
}

/** Turning the voice note into words didn't work, by the server's code. */
export function transcribeTrouble(error = {}) {
  const code = error?.data?.code;
  if (code === "not-configured") return "";
  if (code === "empty-transcript") return "No words were heard in it. Type a few instead.";
  if (code === "concurrency-limit" || error?.status === 429) return "Your blog is busy with another one. Try again in a minute.";
  return "That didn't work. Your voice note is still here; try again, or type instead.";
}

/** Writing it up didn't work. */
export function writeUpTrouble(error = {}) {
  const code = error?.data?.code;
  if (code === "notes-too-long") return "That's more words than it can take. Shorten them a little.";
  if (error?.status === 429 || code === "concurrency-limit") return "Your blog's helper is busy. Try again in a minute.";
  if (code === "no-notes") return "Write a few words about the job first.";
  return "It didn't send back anything usable. Your words are as they were.";
}

/** A job check problem in her words. `service` is the service's name, for an unknown one. */
export function jobProblemWords(problem = {}, { service = "" } = {}) {
  const { field = "", code = "" } = problem;
  if (field === "job.trade") return "Choose your trade.";
  if (field === "job.service") {
    if (code === "unknown-service") return `${quoted(service || "That service")} isn't one of your services yet. Choose one, or add it under Services first.`;
    return "Choose the service this job was.";
  }
  if (field === "job.place.town") return code === "missing" ? "Add the town." : "Just the town's name, not a street address or zip code.";
  if (field === "job.place.region") return code === "missing" ? "Add the state." : "Just the state's name or its two letters.";
  if (field === "job.started") return code === "missing" ? "Add the day you started." : "Pick the day you started from the calendar.";
  if (field === "job.finished") return code === "order" ? "Finished can't be before Started." : code === "missing" ? "Add the day you finished." : "Pick the day you finished from the calendar.";
  if (field === "job.costBand") return "Choose a price range from the list.";
  if (field.startsWith("job.media")) return "A photo marked Before or After isn't on your site any more. Mark another.";
  if (field === "job.review") return "That review isn't saved any more. Choose another.";
  return "Something about this job needs fixing. Tell the person who set up your site.";
}

/** "Before this job goes on your site (2)". */
export const checkHeading = (count) => `Before this job goes on your site (${count})`;

/** The write-up sheet's words: what goes, and where. */
export function writeUpDisclosure({ words = 0, destination = "" } = {}) {
  const where = String(destination || "your blog's helper").trim();
  return `Your words in this job (about ${words}), its service and town go to ${where}. It writes a title, a one-line summary and the four parts from what you said, and nothing more. Your photos and voice note don't go.`;
}

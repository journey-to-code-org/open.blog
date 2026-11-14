// About this job (Studio R4), in Write for a job post: the service, town and state, the days it
// started and finished, the price shown, the customer's review, the trade when the site has more
// than one, and the voice note it was made from. It writes the old Job form's keys exactly
// (parts/job-rules.js applyJobDraft); hours and materials are kept as written. Before and after
// marks come from the photo strip (`mark`), in the order the photos are in the post.
import { h } from "./dom.js";
import { COST_BAND_LABELS, applyJobDraft, dayValue, readJobDraft, tradeLabel } from "./job-rules.js";
import { readPrefs, serviceTitle } from "./new-job-rules.js";
import { appendTranscript } from "./capture-assistant-rules.js";
import { askToTranscribe, transcribeSetup } from "./voice-words.js";

const OTHER = "__other";
const KEYS = ["job.trade", "job.service", "job.place.town", "job.place.region", "job.started", "job.finished", "job.costBand", "job.media.before", "job.media.after", "job.review"];
const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/**
 * `{ meta, fields, capture, api, sheet, onChange, addWords(text, clipped) }`. Returns `{ element,
 * values(), set(fields), focus(field), field(name), mark(url, value), markOf(url), photos(list), describe() }`.
 */
export function createJobAbout({ meta = {}, fields = {}, capture = null, api, sheet, onChange = () => {}, addWords = () => {} }) {
  const job = meta.job || {};
  const services = Array.isArray(job.services) ? job.services.filter((s) => s && typeof s.id === "string") : [];
  const siteTrade = String(job.siteTrade || "");
  let state = readJobDraft(fields);
  let order = []; // photo urls in body order
  const touched = () => onChange();

  const known = (value) => services.some((s) => s.id === value);
  const service = h("select-field", {
    label: "Service", "data-job-field": "job.service",
    options: [{ value: "", label: "Choose a service" }, ...services.map((s) => ({ value: s.id, label: s.title })),
      ...(state.service && !known(state.service) ? [{ value: state.service, label: serviceTitle(state.service) }] : []), { value: OTHER, label: "Something else" }],
    value: state.service,
  });
  const other = h("text-field", { label: "What service?", description: "Add it under Services before you publish, so customers can find it.", hidden: true });
  const town = h("text-field", { label: "Town", description: "Just the town, never the street.", value: state.town, autocomplete: "off", "data-job-field": "job.place.town" });
  const region = h("text-field", { label: "State", value: state.region || (state.town ? "" : String(job.siteRegion || "")), autocomplete: "off", "data-job-field": "job.place.region" });
  const towns = h("div", { class: "studio-row", role: "group", "aria-label": "Recent towns" },
    ...readPrefs(safeStorage()).towns.slice(0, 5).map((name) => h("action-button", { variant: "link", label: `Use ${name}`, onClick: () => { town.value = name; sync(); } }, name)));
  const started = h("date-field", { label: "Started", value: dayValue(state.started), "data-job-field": "job.started" });
  const finished = h("date-field", { label: "Finished", value: dayValue(state.finished), "data-job-field": "job.finished" });
  const bands = job.costBands || Object.keys(COST_BAND_LABELS);
  const price = h("select-field", {
    label: "Price shown", description: "A rough range customers see. It's never a quote.", "data-job-field": "job.costBand",
    options: [{ value: "", label: "Don't show a price" }, ...bands.map((band) => ({ value: band, label: COST_BAND_LABELS[band] || band }))], value: state.costBand,
  });
  const reviews = [...(job.reviews || [])];
  if (state.review && !reviews.some((r) => r.id === state.review)) reviews.push({ id: state.review, label: state.review });
  const review = h("select-field", {
    label: "Customer review", description: reviews.length ? "Shown beside this job." : "Save a customer's review under Reviews, then choose it here.", "data-job-field": "job.review",
    options: [{ value: "", label: "No review" }, ...reviews.map((r) => ({ value: r.id, label: r.label || r.id }))], value: state.review,
  });
  const trades = [...new Set([...(job.trades || []), state.trade].filter(Boolean))];
  const trade = h("select-field", {
    label: "Trade", "data-job-field": "job.trade",
    options: [{ value: "", label: "Choose your trade" }, ...trades.map((t) => ({ value: t, label: tradeLabel(t) }))], value: state.trade || siteTrade,
    hidden: Boolean(siteTrade) && (state.trade || siteTrade) === siteTrade,
  });
  const voice = h("div", { class: "studio-job-voice" });
  const element = h("fieldset", { class: "studio-job-about", "data-job-about": "true" },
    h("legend", { text: "About this job" }),
    service, other,
    h("div", { class: "studio-job-place" }, town, region), towns,
    h("div", { class: "studio-job-days" }, started, finished),
    price, review, trade, voice);

  function sync() {
    state = {
      ...state,
      trade: String(trade.value || siteTrade || ""),
      service: service.value === OTHER ? slug(other.value) : String(service.value || ""),
      town: String(town.value || "").trim(),
      region: String(region.value || "").trim(),
      started: String(started.value || ""),
      finished: String(finished.value || ""),
      costBand: String(price.value || ""),
      review: String(review.value || ""),
    };
    touched();
  }
  service.addEventListener("valuechange", () => {
    other.hidden = service.value !== OTHER;
    if (!other.hidden) requestAnimationFrame(() => other.querySelector("input")?.focus());
    sync();
  });
  for (const field of [other, town, region, started, finished, price, review, trade]) field.addEventListener("valuechange", sync);

  // ---- the voice note it was made from (G30)
  let setup = null;
  function drawVoice() {
    if (!capture?.audio) {
      voice.replaceChildren();
      return;
    }
    const online = globalThis.navigator?.onLine !== false;
    if (online && !setup) {
      setup = { available: false, pending: true };
      transcribeSetup(api).then((found) => { setup = found; drawVoice(); });
    }
    voice.replaceChildren(
      h("p", { class: "studio-label", id: "studio-job-voice-h", text: "Your voice note from the site" }),
      h("div", { class: "studio-row studio-job-voice-row" },
        h("audio", { controls: true, preload: "none", src: `/admin/api/capture-audio?capture=${encodeURIComponent(capture.id)}`, "aria-labelledby": "studio-job-voice-h", class: "studio-audio" }),
        setup?.available ? h("action-button", { variant: "secondary", "data-words": "true", onClick: (event) => toWords(event.currentTarget) }, "Turn it into words") : null));
  }
  async function toWords(opener) {
    const result = await askToTranscribe({ api, sheet, captureId: capture.id, disclosure: setup.disclosure, opener });
    if (!result) return;
    if (result.error !== undefined) {
      if (result.hide) setup = { available: false };
      drawVoice();
      if (result.error) addWords(null, result.error);
      return;
    }
    addWords(result.transcript, "", result.truncated);
  }
  drawVoice();

  return {
    element,
    /** The job's keys as Write's extra values: text, a list, or "" for none. */
    values() {
      // In the order the photos are in the post; a marked photo that isn't in the words (one the old
      // Job form added on its own) keeps its place after them.
      const inOrder = (list) => [...order.filter((url) => list.includes(url)), ...list.filter((url) => !order.includes(url))];
      const next = applyJobDraft({}, { ...state, before: inOrder(state.before), after: inOrder(state.after) });
      return Object.fromEntries(KEYS.map((key) => [key, next[key] ?? ""]));
    },
    /** Her answers from fields (a conflict's other copy). */
    set(next) {
      state = readJobDraft(next);
      service.value = known(state.service) ? state.service : state.service ? OTHER : "";
      other.value = known(state.service) ? "" : serviceTitle(state.service);
      other.hidden = service.value !== OTHER;
      town.value = state.town;
      region.value = state.region;
      started.value = dayValue(state.started);
      finished.value = dayValue(state.finished);
      price.value = state.costBand;
      review.value = state.review;
      trade.value = state.trade || siteTrade;
    },
    /** The control for a job key, to point at a problem. */
    field(key) {
      if (key.startsWith("job.media")) return null;
      return { "job.service": service.value === OTHER ? other : service, "job.place.town": town, "job.place.region": region, "job.started": started, "job.finished": finished, "job.costBand": price, "job.review": review, "job.trade": trade }[key] || null;
    },
    focus(key) {
      const control = this.field(key);
      if (control?.hidden && key === "job.trade") control.hidden = false;
      control?.querySelector("input, select, textarea")?.focus();
    },
    /** The service's name in her words, for a check that says it isn't one of hers. */
    serviceName: () => serviceTitle(state.service, services),
    /** Mark a photo Before, After or Neither. */
    mark(url, value) {
      state.before = state.before.filter((u) => u !== url);
      state.after = state.after.filter((u) => u !== url);
      if (value === "before") state.before.push(url);
      if (value === "after") state.after.push(url);
      touched();
    },
    markOf: (url) => (state.after.includes(url) ? "after" : state.before.includes(url) ? "before" : "neither"),
    /** The photos in the post, in order. */
    photos(urls) {
      order = [...urls];
    },
    /** For the write-up: what the job says now. */
    describe: () => ({ trade: state.trade, service: serviceTitle(state.service, services), town: state.town }),
  };
}

/** A clipped transcript added, in her words. */
export function addedWords(clipped) {
  return `Added to your words. A computer wrote them from your voice note, so read them through.${clipped ? " It was long, so the end was left off." : ""}`;
}

/** Add a transcript under some words. */
export const withTranscript = (words, transcript, max = 8000) => appendTranscript(words, transcript, max);

function safeStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

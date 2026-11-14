// Your route (Studio R7): a route file read on this phone, what readers will see of it, and the
// trip's own suggestions. Pure: no DOM, no network. The file is read with regular expressions, never
// parsed as a document, so nothing in it can load or run; its text is never stored anywhere.
// `analyzeGpx` is lifted from the old Admin (web/admin/admin.js, removed in R15) with three changes:
// the ends trimmed default to 500 m, heights and times are `null` when the file has none, and each
// refusal has a code `gpxProblem` says in her words.
import { say } from "./words.js";

export const MAX_GPX_BYTES = 10 * 1024 * 1024;
export const MAX_POINTS = 100_000;
export const DEFAULT_TRIM = 500;
/** The ends she can leave off, in metres, with their words. */
export const TRIM_CHOICES = Object.freeze([200, 500, 1000, 2000]);
export const PRIVACY = Object.freeze(["hidden", "trimmed", "approximate", "exact"]);
/** The keys Use this route writes, and Undo puts back. */
export const ROUTE_KEYS = Object.freeze(["distanceKm", "elevationGainM", "duration", "locationPrivacy", "routeShape", "elevationProfile", "route"]);

/**
 * Whether an area looks like a street address: digits or a comma, the same rule the build uses for
 * a job's town (ADR 0285, R4).
 */
export const looksLikeAddress = (value) => /[\d,]/.test(String(value || ""));

/** A route file that can't be used, with its code (see `gpxProblem`). */
export class RouteError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** The trim's words: "500 m", "1 km". */
export function trimWords(metres) {
  const m = Number(metres) || 0;
  return m >= 1000 && m % 1000 === 0 ? `${m / 1000} km` : `${m} m`;
}

/** The trim choices with their words, for a select. */
export function trimOptions() {
  const words = { 200: say("route.trim200"), 500: say("route.trim500"), 1000: say("route.trim1000"), 2000: say("route.trim2000") };
  return TRIM_CHOICES.map((value) => ({ value: String(value), label: words[value] }));
}

function distanceMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitude = radians(b.lat - a.lat);
  const longitude = radians(b.lon - a.lon);
  const sinLat = Math.sin(latitude / 2);
  const sinLon = Math.sin(longitude / 2);
  const value = sinLat * sinLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLon * sinLon;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(value)));
}

/** Points as `x,y` pairs in the published page's 1000 × 100 box, segments split by `|`. */
function normalizedSegments(segments, latitudeKey = "lat", longitudeKey = "lon") {
  const points = segments.flat();
  if (points.length < 2) return "";
  const xs = points.map((point) => point[longitudeKey]);
  const ys = points.map((point) => point[latitudeKey]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  return segments
    .filter((segment) => segment.length >= 2)
    .map((segment) => {
      const sampled = segment.length <= 100 ? segment : segment.filter((_, index) => index % Math.ceil(segment.length / 100) === 0 || index === segment.length - 1);
      return sampled.map((point) => `${Math.round(((point[longitudeKey] - minX) / width) * 1000)},${Math.round(100 - ((point[latitudeKey] - minY) / height) * 100)}`).join(" ");
    })
    .join("|");
}

const TRKPT = /<(?:[\w-]+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?trkpt>)/gi;
const TRKSEG = /<(?:[\w-]+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?trkseg>/gi;

function readPoints(text) {
  return [...text.matchAll(TRKPT)].flatMap((match) => {
    const lat = /\blat\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    const lon = /\blon\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    const inner = match[2] || "";
    const ele = /<(?:[\w-]+:)?ele\b[^>]*>\s*([^<]+)</i.exec(inner);
    const time = /<(?:[\w-]+:)?time\b[^>]*>\s*([^<]+)</i.exec(inner);
    const height = ele ? Number(ele[1]) : NaN;
    const at = time ? Date.parse(time[1]) : NaN;
    const point = { lat: Number(lat?.[1]), lon: Number(lon?.[1]), ele: Number.isFinite(height) ? height : null, time: Number.isFinite(at) ? at : null };
    return Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 ? [point] : [];
  });
}

/** The track's segments, each a list of points: `[{ lat, lon, ele, time }]`. Throws RouteError. */
export function readGpx(source) {
  const xml = String(source ?? "");
  if (xml.length > MAX_GPX_BYTES) throw new RouteError("too-big", { bytes: xml.length });
  if (/<!DOCTYPE|<!ENTITY|<script\b|<\?xml-stylesheet/i.test(xml)) throw new RouteError("unsafe");
  if (!/<(?:[\w-]+:)?gpx\b/i.test(xml)) throw new RouteError("not-gpx");
  const authored = [...xml.matchAll(TRKSEG)].map((match) => readPoints(match[1])).filter((segment) => segment.length);
  const segments = authored.length ? authored : [readPoints(xml)];
  const count = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (count > MAX_POINTS) throw new RouteError("too-many-points", { points: count });
  if (count < 2) throw new RouteError("no-route");
  return segments;
}

/**
 * The segments with `trim` metres left off each end of the whole route: the first `trim` metres
 * walked from the start and the last `trim` metres walked to the finish, across segments (a short
 * first or last segment goes whole and the walk goes on into the next), and then every point
 * closer than `trim` in a straight line to where the route started or finished, so a later
 * segment that begins back at home, or a loop that passes it, is left off there too. A segment is
 * split where points are left off (no line is drawn across the gap) and only parts of two or more
 * points stay. Pure; the points keep their positions for the caller to draw.
 */
export function trimEnds(segments, trim) {
  const metres = Math.max(0, Number(trim) || 0);
  const all = segments.filter((segment) => segment.length);
  if (!metres || !all.length) return all.map((segment) => [...segment]).filter((segment) => segment.length >= 2);
  const start = all[0][0];
  const finish = all.at(-1).at(-1);
  // Distance walked from the start to each point, within segments (a recording gap adds nothing,
  // so the walk leaves off at least as much as it says).
  const walked = [];
  let total = 0;
  for (const segment of all) {
    walked.push(segment.map((point, index) => (total += index ? distanceMeters(segment[index - 1], point) : 0)));
  }
  const out = [];
  all.forEach((segment, s) => {
    let part = [];
    segment.forEach((point, i) => {
      const far = walked[s][i] >= metres && total - walked[s][i] >= metres && distanceMeters(start, point) >= metres && distanceMeters(finish, point) >= metres;
      if (far) part.push(point);
      else if (part.length) { out.push(part); part = []; }
    });
    if (part.length) out.push(part);
  });
  return out.filter((part) => part.length >= 2);
}

/**
 * Read a route file and return only what may be published: distance, climb, time, and the
 * drawings for `privacy`. Throws RouteError. `trimMeters` is left off each end when trimmed.
 */
export function analyzeGpx(source, { privacy = "hidden", trimMeters = DEFAULT_TRIM } = {}) {
  const segments = readGpx(source);
  const points = segments.flat();
  const segmentDistances = segments.map((segment) => segment.slice(1).map((point, index) => distanceMeters(segment[index], point)));
  const distanceMeters_ = segmentDistances.flat().reduce((sum, value) => sum + value, 0);
  const hasHeights = points.filter((point) => point.ele !== null).length >= 2;
  const elevationGainM = hasHeights
    ? Math.round(segments.reduce((total, segment) => total + segment.slice(1).reduce((sum, point, index) => sum + (point.ele !== null && segment[index].ele !== null ? Math.max(0, point.ele - segment[index].ele) : 0), 0), 0))
    : null;
  const times = points.map((point) => point.time).filter((time) => time !== null);
  const durationSeconds = times.length > 1 ? Math.max(0, Math.round((times.at(-1) - times[0]) / 1000)) : null;
  const trim = Math.max(0, Math.min(5000, Number(trimMeters) || 0));
  let kept = segments.map((segment) => [...segment]);
  if (privacy === "trimmed") {
    if (distanceMeters_ <= 2 * trim) throw new RouteError("too-short-to-trim", { metres: Math.round(distanceMeters_), trim });
    kept = trimEnds(segments, trim);
    if (!kept.length) throw new RouteError("too-short-to-trim", { metres: Math.round(distanceMeters_), trim });
  }
  let offset = 0;
  const elevationSegments = segments.map((segment, segmentIndex) => {
    let local = 0;
    const heights = segment.flatMap((point, index) => {
      if (index > 0) local += segmentDistances[segmentIndex][index - 1];
      return point.ele !== null ? [{ distance: offset + local, ele: point.ele }] : [];
    });
    offset += segmentDistances[segmentIndex].reduce((sum, value) => sum + value, 0);
    return heights;
  });
  return {
    pointCount: points.length,
    keptPointCount: privacy === "hidden" ? 0 : kept.flat().length,
    segmentCount: segments.length,
    distanceKm: Math.round((distanceMeters_ / 1000) * 100) / 100,
    elevationGainM,
    durationSeconds,
    hasHeights,
    hasTimes: durationSeconds !== null,
    privacy,
    trimMeters: trim,
    routeShape: privacy === "hidden" ? "" : normalizedSegments(kept),
    elevationProfile: hasHeights ? normalizedSegments(elevationSegments, "ele", "distance") : "",
  };
}

/**
 * The route file as it may leave the phone: track points with their position and height only, in
 * their segments. Times, waypoints, routes, names, descriptions, links, the app's details and
 * extensions are left out; numbers are written back from their values, so no other text survives.
 */
export function cleanGpx(source) {
  const segments = readGpx(source);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="open.blog" xmlns="http://www.topografix.com/GPX/1/1">', "<trk>"];
  for (const segment of segments) {
    lines.push("<trkseg>");
    for (const point of segment) {
      lines.push(point.ele !== null && Math.abs(point.ele) <= 10000
        ? `<trkpt lat="${String(point.lat)}" lon="${String(point.lon)}"><ele>${String(point.ele)}</ele></trkpt>`
        : `<trkpt lat="${String(point.lat)}" lon="${String(point.lon)}"/>`);
    }
    lines.push("</trkseg>");
  }
  lines.push("</trk>", "</gpx>", "");
  return lines.join("\n");
}

/** "2 hr 15 min", the way the post's How long is written (the engine reads it back). */
export function durationWords(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (!hours) return `${minutes || (total ? 1 : 0)} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

/** "8.4 km · 420 m climb · 2 hr 15 min", from what the file has. */
export function numbersWords(analysis) {
  return [
    `${analysis.distanceKm} km`,
    analysis.elevationGainM !== null ? `${analysis.elevationGainM} m climb` : "",
    analysis.durationSeconds !== null ? durationWords(analysis.durationSeconds) : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Exactly what Use this route writes, from the analysis for `privacy`: `{ key: value }`, where an
 * empty value takes the key out. Distance always; climb only with heights; How long only with
 * times; the shape only when shown; the climb drawing only with `climb` on (off by default when
 * hidden); `route` is cleared unless exact (the server names the file when it saves).
 */
export function routeValues(analysis, privacy, { climb = privacy !== "hidden" } = {}) {
  const values = {
    distanceKm: String(analysis.distanceKm),
    locationPrivacy: privacy,
    routeShape: privacy === "hidden" ? "" : analysis.routeShape,
    elevationProfile: climb && analysis.hasHeights ? analysis.elevationProfile : "",
  };
  if (analysis.elevationGainM !== null) values.elevationGainM = String(analysis.elevationGainM);
  if (analysis.durationSeconds !== null) values.duration = durationWords(analysis.durationSeconds);
  if (privacy !== "exact") values.route = "";
  return values;
}

/** What readers get, in one line, from the post's fields. */
export function routeLine(fields = {}) {
  const privacy = PRIVACY.includes(String(fields.locationPrivacy || "").toLowerCase()) ? String(fields.locationPrivacy).toLowerCase() : "hidden";
  const hasRoute = Boolean(String(fields.distanceKm || "").trim() || String(fields.routeShape || "").trim() || String(fields.route || "").trim());
  if (!hasRoute) return say("route.lineNone");
  if (privacy === "exact" && String(fields.route || "").trim()) return say("route.lineExact");
  if (privacy === "trimmed" && fields.routeShape) return fields.trim ? say("route.lineTrimmed", { trim: trimWords(fields.trim) }) : say("route.lineTrimmedPlain");
  if ((privacy === "approximate" || privacy === "exact") && fields.routeShape) return say("route.lineWhole");
  return say("route.lineHidden");
}

/**
 * A change of how much readers see, without a file read in this visit: to hidden works at once
 * (`{ ok: true, values }`); anything else needs the file (`{ ok: false, words }`). Going from a
 * published exact route to less says when the file comes off.
 */
export function routeChange(from, to, { haveFile = false, published = false, climb = false } = {}) {
  if (from === to) return { ok: true, values: {} };
  if (to === "hidden") {
    return {
      ok: true,
      values: { locationPrivacy: "hidden", routeShape: "", route: "", ...(climb ? {} : { elevationProfile: "" }) },
      words: from === "exact" && published ? say("route.comesOff") : "",
    };
  }
  if (!haveFile) return { ok: false, words: say("route.chooseAgain") };
  return { ok: true, values: { locationPrivacy: to }, words: from === "exact" && published ? say("route.comesOff") : "" };
}

/** The trip's suggestions, from `fieldJournalReview`, in her words: `[{ id, words, fix }]`. */
export function tripSuggestions(fields = {}) {
  if (String(fields.profile || "").toLowerCase() !== "field-journal") return [];
  const privacy = String(fields.locationPrivacy || "hidden").toLowerCase();
  const area = String(fields.location || "").trim();
  const out = [];
  if (privacy === "exact") out.push({ id: "exact-route", words: say("trip.exactRoute"), fix: "show-less", warning: true });
  if (!area) out.push({ id: "no-area", words: say("trip.noArea"), fix: "location" });
  else if (looksLikeAddress(area)) out.push({ id: "area-looks-like-address", words: say("trip.areaAddress", { area }), fix: "location" });
  if (!String(fields.conditions || "").trim()) out.push({ id: "no-conditions", words: say("trip.noConditions"), fix: "conditions" });
  if (!String(fields.distanceKm || "").trim() && !String(fields.routeShape || "").trim()) out.push({ id: "no-distance", words: say("trip.noDistance"), fix: "route" });
  return out;
}

/** A file or send problem in her words. `error` is a RouteError, a server answer, or a code. */
export function gpxProblem(error) {
  const code = typeof error === "string" ? error : error?.code || error?.data?.code || "";
  switch (code) {
    case "not-gpx": return say("route.notGpx");
    case "too-big": return say("route.tooBig", { size: `${Math.max(1, Math.round((error?.detail?.bytes || 0) / 1024 / 1024))} MB` });
    case "too-many-points": return say("route.tooManyPoints");
    case "no-route": return say("route.noRoute");
    case "unsafe": return say("route.unsafe");
    case "too-short-to-trim": return say("route.tooShort");
    default: return say("route.unreadable");
  }
}

/** What a refused send of the exact file says (track-upload's answers, G49). */
export function sendProblem(error) {
  const code = error?.data?.code || "";
  if (error?.status === 413 || code === "too-large") return say("route.sendTooBig", { max: error?.data?.maxMb || 10 });
  if (code === "empty" || error?.status === 400) return say("route.sendEmpty");
  return say("route.sendUnreadable");
}

/** A save refused because of the route file (G49), in her words, or "" when it isn't one. */
export function saveRouteProblem(error) {
  const code = error?.data?.code || "";
  if (code === "track-expired" || /staged track expired/i.test(error?.data?.error || error?.message || "")) return say("route.expired");
  if (code === "track-needs-exact" || code === "bad-token" || /staged track|track token/i.test(error?.data?.error || "")) return say("route.didntGo");
  return "";
}

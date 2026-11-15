// Your route (Studio R7): a route file read on the phone, what readers see of it, the file that may
// leave the phone, and the trip's suggestions. Ports the old Admin's "GPX analysis…" and "field
// review…" tests (admin-behavior.test.mjs) in their Studio form: 500 m trimmed by default, heights
// and times null when the file has none, refusals by code.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRIM, PRIVACY, ROUTE_KEYS, RouteError, TRIM_CHOICES, analyzeGpx, cleanGpx, durationWords, gpxProblem, looksLikeAddress, numbersWords,
  readGpx, routeChange, routeLine, routeValues, saveRouteProblem, sendProblem, routeLede, trimEnds, trimOptions, tripSuggestions,
} from "../../web/studio/parts/route-rules.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";
import { catalog } from "../../web/studio/parts/words.js";

const SAMPLE_GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
  <trkpt lat="42.0000" lon="-72.0000"><ele>100</ele><time>2026-10-23T10:00:00Z</time></trkpt>
  <trkpt lat="42.0010" lon="-72.0000"><ele>130</ele><time>2026-10-23T10:10:00Z</time></trkpt>
  <trkpt lat="42.0020" lon="-72.0000"><ele>120</ele><time>2026-10-23T10:20:00Z</time></trkpt>
  <trkpt lat="42.0030" lon="-72.0000"><ele>160</ele><time>2026-10-23T10:30:00Z</time></trkpt>
</trkseg></trk></gpx>`;

/** A straight walk north of `km`, one point every 100 m, with heights and times. */
function walk(km, { heights = true, times = true } = {}) {
  const points = [];
  for (let i = 0; i <= km * 10; i += 1) {
    const lat = (42 + i * 0.0009).toFixed(6);
    points.push(`<trkpt lat="${lat}" lon="-72"><ele>${heights ? 100 + i : ""}</ele>${times ? `<time>2026-10-23T10:${String(i % 60).padStart(2, "0")}:00Z</time>` : ""}</trkpt>`);
  }
  return `<gpx version="1.1"><trk><trkseg>${points.join("")}</trkseg></trk></gpx>`.replace(/<ele><\/ele>/g, "");
}

const code = (fn) => { try { fn(); } catch (error) { return error instanceof RouteError ? error.code : `not a RouteError: ${error}`; } return "no error"; };

test("GPX analysis derives portable facts and enforces route privacy", () => {
  const exact = analyzeGpx(SAMPLE_GPX, { privacy: "exact" });
  assert.equal(exact.pointCount, 4);
  assert.ok(exact.distanceKm > 0.3 && exact.distanceKm < 0.4);
  assert.equal(exact.elevationGainM, 70);
  assert.equal(exact.durationSeconds, 1800);
  assert.match(exact.routeShape, /^0,|^\d+,/);
  assert.doesNotMatch(exact.routeShape, /42\.|-72\./, "published drawing data is normalized, never geographic coordinates");

  const trimmed = analyzeGpx(SAMPLE_GPX, { privacy: "trimmed", trimMeters: 100 });
  assert.ok(trimmed.keptPointCount < exact.pointCount);
  assert.ok(trimmed.routeShape);
  const hidden = analyzeGpx(SAMPLE_GPX, { privacy: "hidden" });
  assert.equal(hidden.routeShape, "");
  assert.equal(hidden.keptPointCount, 0);

  const split = analyzeGpx(`<gpx><trk><trkseg><trkpt lat="0" lon="0"></trkpt><trkpt lat="0" lon="0.001"></trkpt></trkseg><trkseg><trkpt lat="40" lon="40"></trkpt><trkpt lat="40" lon="40.001"></trkpt></trkseg></trk></gpx>`, { privacy: "approximate" });
  assert.ok(split.distanceKm < 0.3, "recording gaps between track segments are not counted");
  assert.equal(split.routeShape.split("|").length, 2, "each track segment remains visible without an invented connection");

  const trimmedSplit = analyzeGpx(`<gpx><trk><trkseg><trkpt lat="0" lon="0"></trkpt><trkpt lat="0" lon="0.001"></trkpt><trkpt lat="0" lon="0.002"></trkpt></trkseg><trkseg><trkpt lat="1" lon="1"></trkpt><trkpt lat="1" lon="1.001"></trkpt><trkpt lat="1" lon="1.002"></trkpt></trkseg></trk></gpx>`, { privacy: "trimmed", trimMeters: 50 });
  assert.equal(trimmedSplit.keptPointCount, 4, "privacy trimming removes only the overall route endpoints, not pause boundaries");
  assert.equal(trimmedSplit.routeShape.split("|").length, 2);
});

test("the ends left off default to 500 m, and a route shorter than both ends is refused", () => {
  assert.equal(DEFAULT_TRIM, 500);
  assert.deepEqual(TRIM_CHOICES, [200, 500, 1000, 2000]);
  assert.deepEqual(trimOptions().map((o) => o.value), ["200", "500", "1000", "2000"]);
  const route = walk(3);
  const byDefault = analyzeGpx(route, { privacy: "trimmed" });
  assert.equal(byDefault.trimMeters, 500);
  const at200 = analyzeGpx(route, { privacy: "trimmed", trimMeters: 200 });
  assert.ok(byDefault.keptPointCount < at200.keptPointCount, "500 m leaves off more than 200 m");
  assert.equal(code(() => analyzeGpx(walk(0.9), { privacy: "trimmed" })), "too-short-to-trim", "0.9 km is less than twice 500 m");
  assert.equal(code(() => analyzeGpx(walk(0.9), { privacy: "hidden" })), "no error", "hidden trims nothing");
});

test("heights and times are null when the file has none", () => {
  const flat = analyzeGpx(walk(1, { heights: false, times: false }), { privacy: "approximate" });
  assert.equal(flat.elevationGainM, null);
  assert.equal(flat.durationSeconds, null);
  assert.equal(flat.hasHeights, false);
  assert.equal(flat.elevationProfile, "");
  const values = routeValues(flat, "approximate");
  assert.ok(!("elevationGainM" in values), "no climb in the file: the post's stays");
  assert.ok(!("duration" in values), "no times in the file: How long stays as she wrote it");
});

test("refusals have codes, and each says what to do in her words", () => {
  assert.equal(code(() => readGpx("<html>not a track</html>")), "not-gpx");
  assert.equal(code(() => readGpx("<!DOCTYPE gpx><gpx></gpx>")), "unsafe");
  assert.equal(code(() => readGpx('<gpx><script>alert(1)</script><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></trk></gpx>')), "unsafe");
  assert.equal(code(() => readGpx('<gpx><wpt lat="1" lon="1"><name>Home</name></wpt></gpx>')), "no-route");
  assert.equal(code(() => readGpx(`<gpx>${" ".repeat(10 * 1024 * 1024)}</gpx>`)), "too-big");
  const many = `<gpx><trk><trkseg>${'<trkpt lat="1" lon="1"/>'.repeat(100_001)}</trkseg></trk></gpx>`;
  assert.equal(code(() => readGpx(many)), "too-many-points");
  assert.equal(code(() => readGpx('<gpx><trk><trkseg><trkpt lat="91" lon="0"/><trkpt lat="1" lon="200"/></trkseg></trk></gpx>')), "no-route", "out-of-range points are not points");
  for (const c of ["not-gpx", "too-big", "too-many-points", "no-route", "unsafe", "unreadable", "too-short-to-trim"]) {
    const words = gpxProblem(c);
    assert.ok(words.length > 10, c);
    assert.doesNotMatch(words, HER_BANNED, c);
  }
  assert.equal(gpxProblem(new RouteError("too-big", { bytes: 12 * 1024 * 1024 })), "That route file is too big (12 MB). Files up to 10 MB work.");
  assert.equal(gpxProblem(new Error("x")), "That file couldn't be opened. Choose it again.");
});

test("the file that leaves the phone keeps only positions and heights", () => {
  const source = `<?xml version="1.0"?><gpx version="1.1" creator="Garmin Fenix 7 serial 12345"><metadata><name>Home loop</name><link href="https://example.com/me"><text>me</text></link><time>2026-05-01T07:00:00Z</time></metadata>
<wpt lat="39.1" lon="-79.6"><name>My house</name></wpt><rte><rtept lat="39.2" lon="-79.7"/></rte>
<trk><name>Morning</name><desc>From home</desc><trkseg>
<trkpt lat="39.0001" lon="-79.5001"><ele>1012.5</ele><time>2026-05-01T07:00:00Z</time><extensions><hr>140</hr></extensions></trkpt>
<gpx:trkpt lat="39.0002" lon="-79.5002"><time>2026-05-01T07:01:00Z</time></gpx:trkpt>
</trkseg><trkseg><trkpt lat="39.0003" lon="-79.5003"/><trkpt lat="39.0004" lon="-79.5004"><ele>1013</ele></trkpt></trkseg></trk></gpx>`;
  const cleaned = cleanGpx(source);
  for (const gone of ["<time", "<wpt", "<rte", "<metadata", "<name", "<desc", "<link", "<extensions", "Garmin", "12345", "My house", "Home loop", "39.1\"", "<hr"]) {
    assert.ok(!cleaned.includes(gone), `${gone} is gone`);
  }
  assert.ok(cleaned.includes('<trkpt lat="39.0001" lon="-79.5001"><ele>1012.5</ele></trkpt>'));
  assert.ok(cleaned.includes('<trkpt lat="39.0002" lon="-79.5002"/>'));
  assert.equal(cleaned.match(/<trkseg>/g).length, 2);
  // The cleaned file reads back as the same route, and the server's own check takes it: one gpx root,
  // nested elements, at least two bounded points inside trk/trkseg (validate_gpx in admin.rs).
  assert.equal(analyzeGpx(cleaned, { privacy: "exact" }).pointCount, 4);
  assert.match(cleaned, /^<\?xml[^>]*>\n<gpx [^>]*>\n<trk>\n<trkseg>\n/);
  assert.ok(cleaned.trimEnd().endsWith("</trk>\n</gpx>"));
  assert.doesNotMatch(cleaned, /<!|<script/i);
  // Attribute values are numbers written back, never her text.
  const hostile = cleanGpx('<gpx><trk><trkseg><trkpt lat="1" lon="1&quot; onload=&quot;x"/><trkpt lat="1.5e0" lon="2"/><trkpt lat="2" lon="3"/></trkseg></trk></gpx>');
  assert.doesNotMatch(hostile, /onload|quot/);
  assert.ok(hostile.includes('lat="1.5"'));
});

test("what Use this route writes: hidden keeps no shape, and no climb drawing unless switched on", () => {
  const analysis = analyzeGpx(SAMPLE_GPX, { privacy: "hidden" });
  const hidden = routeValues(analysis, "hidden");
  assert.equal(hidden.routeShape, "");
  assert.equal(hidden.elevationProfile, "", "the climb drawing is opt-in when hidden");
  assert.equal(hidden.route, "");
  assert.equal(hidden.locationPrivacy, "hidden");
  assert.equal(hidden.duration, "30 min");
  assert.equal(hidden.elevationGainM, "70");
  assert.ok(routeValues(analysis, "hidden", { climb: true }).elevationProfile);
  const whole = routeValues(analyzeGpx(SAMPLE_GPX, { privacy: "approximate" }), "approximate");
  assert.ok(whole.routeShape && whole.elevationProfile, "shown routes draw the climb by default");
  assert.equal(whole.route, "");
  const exact = routeValues(analyzeGpx(SAMPLE_GPX, { privacy: "exact" }), "exact");
  assert.ok(!("route" in exact), "the server names the exact file when it saves");
  for (const key of Object.keys({ ...hidden, ...exact })) assert.ok(ROUTE_KEYS.includes(key), key);
});

test("the line says what readers get", () => {
  assert.equal(routeLine({}), "No route added.");
  assert.equal(routeLine({ distanceKm: "3" }), "Route: readers see the numbers only.");
  assert.equal(routeLine({ distanceKm: "3", locationPrivacy: "trimmed", routeShape: "0,1 2,3", trim: 500 }), "Route: readers see a drawing without the first and last 500 m.");
  assert.equal(routeLine({ distanceKm: "3", locationPrivacy: "trimmed", routeShape: "0,1 2,3" }), "Route: readers see a drawing without the first and last part.");
  assert.equal(routeLine({ distanceKm: "3", locationPrivacy: "approximate", routeShape: "0,1 2,3" }), "Route: readers see a drawing of the whole route.");
  assert.equal(routeLine({ distanceKm: "3", locationPrivacy: "exact", routeShape: "0,1 2,3", route: "/tracks/uploads/2026/a.gpx" }), "Route: readers can download your exact route.");
  assert.equal(routeLine({ distanceKm: "3", locationPrivacy: "exact" }), "Route: readers see the numbers only.", "exact with no file yet gives no download");
});

test("changing how much shows without a file: hidden at once, anything else needs the file", () => {
  assert.deepEqual(routeChange("approximate", "hidden"), { ok: true, values: { locationPrivacy: "hidden", routeShape: "", route: "", elevationProfile: "" }, words: "" });
  assert.deepEqual(routeChange("approximate", "hidden", { climb: true }).values, { locationPrivacy: "hidden", routeShape: "", route: "" });
  assert.equal(routeChange("exact", "hidden", { published: true }).words, "Your route file comes off your site when you press Update.");
  assert.deepEqual(routeChange("hidden", "trimmed"), { ok: false, words: "Choose your route file again to show it this way." });
  assert.equal(routeChange("hidden", "trimmed", { haveFile: true }).ok, true);
});

test("field review makes exact-location risk and missing observations explicit", () => {
  assert.deepEqual(tripSuggestions({ profile: "article" }), []);
  const exact = tripSuggestions({ profile: "field-journal", locationPrivacy: "exact", distanceKm: "3.4" });
  assert.deepEqual(exact.map((s) => s.id), ["exact-route", "no-area", "no-conditions"]);
  assert.match(exact[0].words, /rare plants or animals/);
  assert.equal(exact[0].warning, true);
  assert.deepEqual(tripSuggestions({ profile: "field-journal", location: "North woods", conditions: "Dry", distanceKm: "3.4" }), []);
  assert.deepEqual(tripSuggestions({ profile: "field-journal", location: "12 Laurel Lane", conditions: "Dry" }).map((s) => s.id), ["area-looks-like-address", "no-distance"]);
  assert.ok(looksLikeAddress("Route 9, Elkview") && !looksLikeAddress("Seneca Rocks"));
});

test("durations are written the way the post reads them back", () => {
  assert.equal(durationWords(8100), "2 hr 15 min");
  assert.equal(durationWords(3600), "1 hr");
  assert.equal(durationWords(40), "1 min");
  assert.equal(numbersWords({ distanceKm: 8.4, elevationGainM: 420, durationSeconds: 8100 }), "8.4 km · 420 m climb · 2 hr 15 min");
  assert.equal(numbersWords({ distanceKm: 8.4, elevationGainM: null, durationSeconds: null }), "8.4 km");
});

test("the server's refusals of a route file say what to do", () => {
  assert.equal(sendProblem({ status: 413, data: { code: "too-large", maxMb: 8 } }), "That route file is too big for your blog (8 MB at most). Show less of the route, or ask the person who set up your site.");
  assert.equal(sendProblem({ status: 415, data: { code: "not-gpx" } }), "Your blog couldn't read that route file. Choose another, or show less of the route.");
  assert.equal(sendProblem({ status: 400, data: { code: "empty" } }), "That route file is empty. Choose it again.");
  assert.equal(saveRouteProblem({ status: 422, data: { code: "track-expired" } }), "Your route file waited too long. Choose it again in Your route, then save.");
  assert.equal(saveRouteProblem({ status: 422, data: { error: "staged track expired; import the GPX again" } }), "Your route file waited too long. Choose it again in Your route, then save.");
  assert.equal(saveRouteProblem({ status: 422, data: { code: "track-needs-exact" } }), "Your route file didn't go with the post. Choose it again in Your route.");
  assert.equal(saveRouteProblem({ status: 422, data: { code: "date" } }), "");
});

test("no her-layer route word uses a word she never sees", () => {
  for (const [id, entry] of Object.entries(catalog())) {
    if (!/^(route|trip|youtube|ready|review)\./.test(id) || entry.layer !== "her") continue;
    // The help that names what other apps call the file, and the file's ending as she sees it.
    if (id === "route.appsHelp" || id === "route.notGpx") continue;
    assert.doesNotMatch(entry.text, HER_BANNED, id);
    assert.doesNotMatch(entry.text, /\b(GPX|track|coordinates|latitude|upload|token|OpenGraph|WCAG|SEO|score|readiness|audit|finding|acknowledge|validator|fingerprint|Studio|Admin)\b/i, id);
  }
});

// QA (R7 blocker): the ends are left off across segments, not only inside the first and last one.
/** A segment north of (lat, lon) of `metres`, one point every `step` metres. */
function segment(lat, lon, metres, step = 25) {
  const out = [];
  for (let m = 0; m <= metres; m += step) out.push(`<trkpt lat="${(lat + m / 111_195).toFixed(7)}" lon="${lon}"/>`);
  return `<trkseg>${out.join("")}</trkseg>`;
}
const gpxOf = (...segments) => `<gpx version="1.1"><trk>${segments.join("")}</trk></gpx>`;
function metresBetween(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(s)));
}
const HOME = { lat: 42, lon: -72 };
const nearest = (kept, place) => Math.min(...kept.flat().map((point) => metresBetween(point, place)));

test("QA repro: a 50 m segment, then a 3 km segment starting at home, keeps nothing within 500 m of home", () => {
  const source = gpxOf(segment(42, -72, 50), segment(42, -72, 3000));
  const kept = trimEnds(readGpx(source), 500);
  assert.ok(nearest(kept, HOME) >= 500, `a kept point is ${Math.round(nearest(kept, HOME))} m from home`);
  assert.ok(kept.every((part) => part.length >= 2), "a segment left with one point is dropped");
  const a = analyzeGpx(source, { privacy: "trimmed" });
  assert.equal(a.keptPointCount, kept.flat().length);
});

test("the end is left off across segments too, and whole short segments go", () => {
  // 3 km going north, then two short segments that come back and end at home.
  const end = { lat: 42 + 3000 / 111_195, lon: -72 };
  const source = gpxOf(segment(42, -71.9, 3000), segment(end.lat - 40 / 111_195, -72, 40), segment(end.lat - 30 / 111_195, -72, 30, 10));
  const kept = trimEnds(readGpx(source), 500);
  const last = readGpx(source).at(-1).at(-1);
  assert.ok(nearest(kept, last) >= 500, `a kept point is ${Math.round(nearest(kept, last))} m from the end`);
  assert.equal(kept.length, 1, "the two short segments at the end are dropped whole");
});

test("a later segment that starts back at home is left off near home as well", () => {
  // 600 m away (more than the trim along the way), then a new segment that starts at home again.
  const source = gpxOf(segment(42, -72, 600), segment(42, -72, 3000));
  const kept = trimEnds(readGpx(source), 500);
  assert.ok(nearest(kept, HOME) >= 500, `a kept point is ${Math.round(nearest(kept, HOME))} m from home`);
});

test("every trim choice keeps every drawn point at least that far from both ends", () => {
  const source = gpxOf(segment(42, -72, 120), segment(42.0005, -72, 80), segment(42, -72.01, 5000), segment(42.05, -72, 60));
  const segments = readGpx(source);
  const start = segments[0][0];
  const finish = segments.at(-1).at(-1);
  for (const trim of TRIM_CHOICES) {
    const kept = trimEnds(segments, trim);
    assert.ok(nearest(kept, start) >= trim && nearest(kept, finish) >= trim, `trim ${trim}`);
  }
});

test("a route that never gets far enough from its ends is too short to trim", () => {
  // A loop of small out-and-backs around home: long enough in total, never 500 m away.
  const source = gpxOf(...Array.from({ length: 8 }, () => segment(42, -72, 300)));
  assert.equal(code(() => analyzeGpx(source, { privacy: "trimmed" })), "too-short-to-trim");
});

test("the lede says what goes to the blog for each choice, the exact route's file included", () => {
  assert.match(routeLede("hidden", "phone"), /only the numbers go to/);
  assert.doesNotMatch(routeLede("hidden", "phone"), /a drawing go/);
  for (const choice of ["trimmed", "approximate"]) assert.match(routeLede(choice, "phone"), /only the numbers and a drawing go to/);
  const exact = routeLede("exact", "iPad");
  assert.match(exact, /a cleaned copy of the route file goes to .* too/);
  assert.match(exact, /times and your app's details taken out/);
  assert.match(exact, /this iPad/);
  for (const choice of PRIVACY) assert.doesNotMatch(routeLede(choice, "phone"), HER_BANNED, choice);
});

test("the route's numbers are words a site can change, not fixed strings", async () => {
  const { configureWords } = await import("../../web/studio/parts/words.js");
  configureWords({ text: { "route.km": "{km} kilometres", "route.climbM": "{m} metres up" } });
  try {
    assert.equal(numbersWords({ distanceKm: 8.4, elevationGainM: 420, durationSeconds: null }), "8.4 kilometres · 420 metres up");
  } finally {
    configureWords();
  }
  assert.equal(numbersWords({ distanceKm: 8.4, elevationGainM: 420, durationSeconds: 8100 }), "8.4 km · 420 m climb · 2 hr 15 min");
});

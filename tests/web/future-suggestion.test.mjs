// Suggestions for future work (#227, ADRs 0191 to 0195): the browser and hosted-function half of the
// contract in crates/openblog-core/src/future_suggestion.rs, held to the Rust side case by case
// through two shared fixtures, plus the pure helpers the form and the function use.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCEPTANCE_NOTICE, FUTURE_SUGGESTION_KIND, MAX_STORED_DETAILS_BYTES, MAX_SUBMISSION_BYTES, storedDetailsBytes, holdsIdentity, isPlainAddress, isSlug, normalizeSuggestionUrl, readClarification, readSuggestionSubmissionJson,
  receiveSuggestion, scrubbedIdentity, slugify, suggestionCopyText, suggestionDetails,
} from "../../web/components/future-suggestion.js";
import { publicUrlProblem } from "../../web/components/public-url.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const urls = read("../fixtures/public-urls.json");
const fixture = read("../fixtures/future-suggestion-submissions.json");

test("the public address rule gives the build's answer and reason for every address", () => {
  assert.ok(urls.cases.length > 100);
  for (const { url, problem } of urls.cases) assert.equal(publicUrlProblem(url), problem, url);
});

test("a suggestion is read and received exactly as the build reads and receives it", () => {
  assert.ok(fixture.cases.length > 100);
  for (const entry of fixture.cases) {
    const text = entry.text ?? JSON.stringify(entry.request);
    const result = readSuggestionSubmissionJson(text);
    if (entry.expect.code) {
      assert.equal(result.ok, false, `${entry.name}: should be refused`);
      assert.equal(result.error.code, entry.expect.code, entry.name);
      // A refusal names the field and never repeats what the reader wrote.
      for (const word of ["Surveyor", "ada@example.org", "Lovelace"]) assert.ok(!result.error.message.includes(word), entry.name);
      continue;
    }
    assert.equal(result.ok, true, `${entry.name}: ${result.error?.message}`);
    const { record, row } = receiveSuggestion(result.submission, fixture.work, fixture.receivedAt);
    assert.deepEqual(JSON.parse(JSON.stringify(record)), entry.expect.record, entry.name);
    assert.deepEqual(JSON.parse(JSON.stringify(row)), entry.expect.row, entry.name);
  }
});

test("a received suggestion's details are exactly what the row keeps, and the text and name stay in their columns", () => {
  const { submission } = readSuggestionSubmissionJson(JSON.stringify({
    version: 1, kind: "future-suggestion", type: "source", text: "A private archive.", url: "https://example.org/archive",
    attribution: { name: "Ada", publishName: false }, contact: { address: "ada@example.org", followUp: true },
  }));
  const details = suggestionDetails(submission);
  assert.deepEqual(Object.keys(details).sort(), ["contact", "type", "url"]);
  assert.ok(!("text" in details) && !("attribution" in details) && !("name" in details));
  const { row } = receiveSuggestion(submission, "/posts/tides/", "2026-10-26T10:00:00Z");
  assert.equal(row.reader_name, "Ada");
  assert.equal(row.publish_name, false);
  assert.equal(row.revision, null);
  assert.equal(row.target, null);
  assert.equal(row.kind, FUTURE_SUGGESTION_KIND);
  assert.throws(() => receiveSuggestion(submission, "posts/tides", "2026-10-26T10:00:00Z"), TypeError);
  assert.throws(() => receiveSuggestion(submission, "/posts/tides/", "yesterday"), TypeError);
});

test("one shared rule: a link is the build's link rule and nothing of its own", () => {
  assert.equal(normalizeSuggestionUrl("https://Example.ORG/a/../c"), "https://example.org/c");
  for (const url of ["http://[::127.0.0.1]/", "http://[2002:7f00:1::]/", "http://[64:ff9b::7f00:1]/", "http://[fec0::1]/", "http://localhost.localdomain/", "http://x.home/", "http://x.test/", "http://x.corp/", "http://198.18.0.1/", "https://example.org/?access_token=1"]) {
    assert.equal(normalizeSuggestionUrl(url), null, url);
  }
  // The module keeps no private-address rule of its own.
  const source = readFileSync(new URL("../../web/components/future-suggestion.js", import.meta.url), "utf8");
  for (const fragment of ["127.", "169.254", "localhost", "192.168"]) assert.ok(!source.includes(fragment), fragment);
});

test("slugs are the site's own, non-ASCII included", () => {
  assert.equal(slugify("Marées d’été"), "marées-d-été");
  for (const slug of ["marées", "水のいろ", "tides-2026"]) assert.ok(isSlug(slug), slug);
  for (const slug of ["Tides", "a--b", "-a", "a-", "a b", "", "a".repeat(65)]) assert.ok(!isSlug(slug), slug);
});

test("contact addresses are plain mailboxes and nothing else", () => {
  assert.ok(isPlainAddress("a.b+tag@sub.example.org"));
  for (const address of ["", "ada@", "Ada <ada@example.org>", "a@b", "a..b@example.org", "ada@exämple.org", "\"a\"@example.org", `${"a".repeat(250)}@example.org`]) assert.ok(!isPlainAddress(address), address);
});

test("a clarification replaces the text under the same rule", () => {
  assert.equal(readClarification("  Here is what I meant.  "), "Here is what I meant.");
  for (const value of ["", "   ", "x".repeat(2001), "a\u202eb", 5, null]) assert.equal(readClarification(value), null);
});

test("private identity is what retention clears, and nothing else", () => {
  const kept = { details: { type: "text", url: "https://example.org/a", contact: { address: "a@example.org", followUp: true } }, reader_name: "Ada", publish_name: false };
  assert.equal(holdsIdentity(kept), true);
  assert.deepEqual(scrubbedIdentity(kept), { details: { type: "text", url: "https://example.org/a" }, reader_name: null });
  const shown = { details: { type: "text" }, reader_name: "Ada", publish_name: true };
  assert.equal(holdsIdentity(shown), false);
  assert.deepEqual(scrubbedIdentity(shown), { details: { type: "text" }, reader_name: "Ada" });
  assert.equal(holdsIdentity({ details: { type: "text" }, reader_name: null, publish_name: false }), false);
});

test("the copy-and-send text carries the words, the link and the record, and never claims acceptance", () => {
  const { submission } = readSuggestionSubmissionJson(JSON.stringify({
    version: 1, kind: "future-suggestion", type: "video", text: "Worth watching.", url: "https://example.org/v",
    hints: { title: "The survey", creators: ["A. Surveyor"] }, about: { series: "tides" },
  }));
  const copy = suggestionCopyText(submission, "https://blog.example/posts/tides/");
  assert.match(copy, /Worth watching\./);
  assert.match(copy, /Link: https:\/\/example\.org\/v/);
  assert.match(copy, /the series tides/);
  const last = copy.split("\n").at(-1);
  assert.deepEqual(JSON.parse(last), submission);
  assert.ok(!/accepted|approved|endorse/i.test(copy));
  assert.match(ACCEPTANCE_NOTICE, /does not mean they agree/);
});

test("stored details are measured as Postgres measures jsonb text, below the column's 16 KiB", () => {
  assert.equal(storedDetailsBytes({ type: "text" }), Buffer.byteLength('{"type": "text"}'));
  assert.equal(storedDetailsBytes({ a: ["x", "y"], b: { c: 1 } }), Buffer.byteLength('{"a": ["x", "y"], "b": {"c": 1}}'));
  assert.ok(MAX_STORED_DETAILS_BYTES < 16 * 1024);
  const wide = `https://example.org/${"漢".repeat(225)}`;
  const text = JSON.stringify({
    version: 1, kind: "future-suggestion", type: "source", text: "x", url: wide,
    hints: { title: "😀".repeat(300), publisher: "😀".repeat(300), creators: Array(7).fill("😀".repeat(200)), identifiers: Array(4).fill({ scheme: "url", value: wide }) },
  });
  assert.ok(Buffer.byteLength(text) <= MAX_SUBMISSION_BYTES);
  const result = readSuggestionSubmissionJson(text);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tooLarge");
});

// The source library's rules (Studio R11), ported from the old Admin's admin-sources.test.mjs: its
// pure cases keep their behaviour, with people and identifiers as rows instead of typed lines, and
// every message a word id. The old view cases (list, search, empty and damaged states, create,
// edit, archive, a scoped rejection, a conflict, import, export) are studio-research.spec.mjs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SOURCE_KINDS, creatorRows, filterSources, identifierRows, mergeSourceCreators, rowsToCreators, rowsToIdentifiers, sourceDependents, sourceDiagnosticControl,
  sourceDraft, sourceDraftPayload, sourceExportLossNotes, sourceFieldsForKind, sourceImportRows, sourceImportSummary, sourceLabel, sourceRelationOptions,
  sourceTargetVolumes, sourceUnchanged, suggestKey, validateSourceDraft, rightsText,
} from "../../web/studio/parts/source-rules.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

const LIBRARY = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία", language: "grc", creators: [{ name: "Plato", role: "author", dates: "428-348 BC" }], shelf: { room: "B" } },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam", issued: "2003", identifiers: [{ scheme: "isbn", value: "9780198145691" }] },
  { id: "bloom-1968", kind: "translation", of: "plato-republic", title: "The Republic", language: "en", archived: true },
  { id: "cave", kind: "reference", of: "slings-2003", location: { scheme: "page", value: "514a" } },
];
const rows = (text) => text.split("\n").filter(Boolean).map((line) => { const [name, role = ""] = line.split(" | "); return { name, role }; });

test("search and filters match ids, titles, creators, and identifiers and hide archived by default", () => {
  const sources = LIBRARY();
  assert.deepEqual(filterSources(sources).map((source) => source.id), ["plato-republic", "slings-2003", "cave"]);
  assert.deepEqual(filterSources(sources, { archived: "archived" }).map((source) => source.id), ["bloom-1968"]);
  assert.equal(filterSources(sources, { archived: "all" }).length, 4);
  assert.deepEqual(filterSources(sources, { query: "PLATO" }).map((source) => source.id), ["plato-republic", "slings-2003"], "creator names and titles match ignoring case");
  assert.deepEqual(filterSources(sources, { query: "9780198145691" }).map((source) => source.id), ["slings-2003"]);
  assert.deepEqual(filterSources(sources, { query: "rempublicam 2003" }).map((source) => source.id), ["slings-2003"], "every term must match");
  assert.deepEqual(filterSources(sources, { kind: "reference" }).map((source) => source.id), ["cave"]);
  assert.deepEqual(filterSources(sources, { query: "nothing here" }), []);
  assert.deepEqual(filterSources(null), []);
  assert.deepEqual(sourceDependents(sources, "plato-republic").map((source) => source.id), ["slings-2003", "bloom-1968"]);
  assert.deepEqual(
    sourceDependents([...sources, { id: "slings-2005", kind: "edition", of: "plato-republic", revises: "slings-2003" }], "slings-2003").map((source) => source.id),
    ["cave", "slings-2005"],
    "a revised edition depends on the edition it revises",
  );
});

test("each supported source type shows only its own fields and valid relations", () => {
  assert.deepEqual([...SOURCE_KINDS], ["work", "edition", "translation", "witness", "reference"]);
  assert.deepEqual(sourceFieldsForKind("work"), { of: false, basedOn: false, location: false, titleRequired: true, languageRequired: false });
  assert.equal(sourceFieldsForKind("translation").basedOn, true);
  assert.equal(sourceFieldsForKind("translation").languageRequired, true);
  assert.equal(sourceFieldsForKind("reference").location, true);
  assert.equal(sourceFieldsForKind("reference").titleRequired, false);
  const sources = LIBRARY();
  assert.deepEqual(sourceRelationOptions(sources, "translation", "of").map((source) => source.id), ["plato-republic"]);
  assert.deepEqual(sourceRelationOptions(sources, "reference", "of").map((source) => source.id), ["plato-republic", "slings-2003", "bloom-1968"]);
  assert.deepEqual(sourceRelationOptions(sources, "translation", "basedOn", "bloom-1968").map((source) => source.id), ["slings-2003"], "never itself");
  assert.deepEqual(sourceRelationOptions(sources, "work", "of"), []);
});

test("a draft round-trips losslessly and keeps fields the form does not edit", () => {
  const work = LIBRARY()[0];
  assert.deepEqual(sourceDraftPayload(sourceDraft(work)), work, "unknown fields inside creators and beside the form fields survive");
  assert.equal(JSON.stringify(sourceDraftPayload(sourceDraft(work))), JSON.stringify(work), "in the same order");
  assert.equal(sourceUnchanged(sourceDraft(work)), true);

  const edited = sourceDraft(work);
  edited.title = "Republic";
  edited.creators = rows("Plato | author\nGlaucon");
  const payload = sourceDraftPayload(edited);
  assert.equal(payload.title, "Republic");
  assert.deepEqual(payload.creators, [work.creators[0], { name: "Glaucon" }]);
  assert.deepEqual(payload.shelf, { room: "B" });

  assert.equal(sourceDraftPayload(sourceDraft(LIBRARY()[2])).archived, true, "editing never restores an archived source");

  const reference = Object.assign(sourceDraft(null, "reference"), { id: "r", of: "slings-2003", title: "  ", locationScheme: "page", locationValue: " 12 ", basedOn: "x", language: "" });
  assert.deepEqual(sourceDraftPayload(reference), { id: "r", kind: "reference", of: "slings-2003", location: { scheme: "page", value: "12" } });
  const work2 = Object.assign(sourceDraft(null, "work"), { id: "w", title: "W", of: "stale", locationValue: "x", locationScheme: "page" });
  assert.deepEqual(sourceDraftPayload(work2), { id: "w", kind: "work", title: "W" }, "fields of another type are dropped");
});

test("version provenance the form does not edit yet survives a round trip", () => {
  const edition = {
    id: "burnet-1902", kind: "edition", of: "plato-republic", title: "Platonis Opera IV", revises: "burnet-1900", volumes: 5,
    rights: { status: "publicDomain", note: "Published 1902" },
    creators: [{ name: "John Burnet", role: "editor", attribution: "stated", note: "Title page" }],
  };
  assert.deepEqual(sourceDraftPayload(sourceDraft(edition)), edition);
  const payload = sourceDraftPayload(Object.assign(sourceDraft(edition), { title: "Platonis Opera" }));
  assert.equal(payload.title, "Platonis Opera");
  assert.deepEqual(payload.rights, edition.rights, "her rights statement is never dropped by an edit (decision 9)");
  assert.equal(payload.revises, "burnet-1900");
  assert.deepEqual(payload.creators, edition.creators, "attribution certainty stays on an unchanged creator");
  const reference = { id: "r", kind: "reference", of: "burnet-1902", location: { scheme: "page", value: "327", volume: "4" } };
  assert.deepEqual(sourceDraftPayload(sourceDraft(reference)).location, reference.location, "the volume stays with an unchanged location");
});

test("an edited person or location keeps the provenance the form does not edit", () => {
  const work = {
    id: "magna-moralia", kind: "work", title: "Magna Moralia", anonymous: true,
    creators: [
      { name: "Aristotle", role: "author", attribution: "disputed", note: "Most scholars doubt it", family: "Aristotle", x: 1 },
      { name: "Theophrastus", role: "other", attribution: "uncertain" },
    ],
  };
  const renamed = sourceDraftPayload(Object.assign(sourceDraft(work), { creators: rows("Pseudo-Aristotle | author\nTheophrastus | other") }));
  assert.deepEqual(renamed.creators, [{ name: "Pseudo-Aristotle", role: "author", attribution: "disputed", note: "Most scholars doubt it", x: 1 }, work.creators[1]],
    "a renamed person keeps attribution, note and unknown fields, but not name parts of the old name");
  const roleChanged = sourceDraftPayload(Object.assign(sourceDraft(work), { creators: rows("Aristotle | editor\nTheophrastus") }));
  assert.deepEqual(roleChanged.creators, [{ ...work.creators[0], role: "editor" }, { name: "Theophrastus", attribution: "uncertain" }], "a changed or removed role keeps everything else");
  const reordered = sourceDraftPayload(Object.assign(sourceDraft(work), { creators: rows("Theophrastus | other\nAristotle | author") }));
  assert.deepEqual(reordered.creators, [work.creators[1], work.creators[0]], "people follow their names when rows move");
  const removed = sourceDraftPayload(Object.assign(sourceDraft(work), { creators: rows("Theophrastus | other") }));
  assert.deepEqual(removed.creators, [work.creators[1]], "a row taken out removes only that person");

  const sources = [{ id: "burnet-1902", kind: "edition", of: "plato-republic", title: "Opera", volumes: 5 }];
  const reference = { id: "r", kind: "reference", of: "burnet-1902", location: { scheme: "page", value: "327", volume: "4", note: "x" } };
  assert.deepEqual(sourceDraftPayload(Object.assign(sourceDraft(reference), { locationValue: "328" })).location, { scheme: "page", value: "328", volume: "4", note: "x" });
  assert.deepEqual(sourceDraftPayload(Object.assign(sourceDraft(reference), { locationVolume: " 5 " })).location, { scheme: "page", value: "327", volume: "5", note: "x" });
  assert.deepEqual(sourceDraftPayload(Object.assign(sourceDraft(reference), { locationScheme: "canonical", locationValue: "327a", locationVolume: "" })).location, { scheme: "canonical", value: "327a", note: "x" }, "a volume she cleared is removed");
  assert.deepEqual(sourceDraftPayload(Object.assign(sourceDraft(null, "reference"), { id: "n", of: "burnet-1902", locationScheme: "page", locationValue: "2", locationVolume: "3" })).location, { scheme: "page", value: "2", volume: "3" });
  assert.equal(sourceTargetVolumes(sources, "burnet-1902"), 5);
  assert.equal(sourceTargetVolumes(sources, "missing"), 0);
  assert.equal(validateSourceDraft(Object.assign(sourceDraft(null, "reference"), { id: "n", of: "burnet-1902", locationVolume: "3" }), sources).field, "locationValue");
  assert.equal(sourceDiagnosticControl("location.volume"), "locationVolume");
});

test("rows for people and identifiers keep what they hold, and empty rows go", () => {
  assert.deepEqual(rowsToCreators([{ name: "Ada", role: "author" }, { name: "  ", role: "editor" }, { name: " Bob ", role: "" }, { name: "Carl", role: "wizard" }]),
    [{ name: "Ada", role: "author" }, { name: " Bob " }, { name: "Carl", role: "wizard" }], "a role this release doesn't list is kept as it is");
  assert.deepEqual(rowsToIdentifiers([{ scheme: "DOI", value: "10.1000/182" }, { scheme: "url", value: "" }, { scheme: "", value: "loose" }]), [{ scheme: "doi", value: "10.1000/182" }, { scheme: "", value: "loose" }]);
  const hostile = Object.assign(sourceDraft(null, "work"), { id: "w", title: "<img src=x onerror=alert(1)>", identifiers: [{ scheme: "url", value: "javascript:alert(1)" }] });
  const payload = sourceDraftPayload(hostile);
  assert.equal(payload.title, "<img src=x onerror=alert(1)>", "text stays data; the server decides what is unsafe");
  assert.deepEqual(payload.identifiers, [{ scheme: "url", value: "javascript:alert(1)" }]);
});

test("rows round-trip every source in the fixtures and the examples unchanged when untouched", () => {
  const repo = new URL("../../", import.meta.url).pathname;
  const found = [];
  const look = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) look(path);
      else if (entry.name.endsWith(".json")) {
        let json;
        try { json = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
        // Any list called `sources` of library records, however deep.
        const walk = (value) => {
          if (Array.isArray(value)) { value.forEach(walk); return; }
          if (!value || typeof value !== "object") return;
          for (const [key, child] of Object.entries(value)) {
            if (key === "sources" && Array.isArray(child)) found.push(...child.filter((s) => s && typeof s === "object" && SOURCE_KINDS.includes(s.kind) && typeof s.id === "string"));
            walk(child);
          }
        };
        walk(json);
      }
    }
  };
  look(join(repo, "tests/fixtures"));
  look(join(repo, "examples"));
  const all = [...LIBRARY(), ...found];
  assert.ok(found.length >= 3, `found ${found.length} sources in fixtures`);
  for (const source of all) {
    assert.deepEqual(rowsToCreators(creatorRows(source.creators)).length, (source.creators || []).filter((c) => String(c?.name ?? "").trim()).length, source.id);
    assert.equal(JSON.stringify(sourceDraftPayload(sourceDraft(source))), JSON.stringify(source), `${source.id} goes back byte for byte`);
    assert.deepEqual(mergeSourceCreators(rowsToCreators(creatorRows(source.creators)), source.creators), (source.creators || []).filter((c) => String(c?.name ?? "").trim()), source.id);
    assert.deepEqual(rowsToIdentifiers(identifierRows(source.identifiers)).length, (source.identifiers || []).filter((i) => String(i?.value ?? "").trim()).length, source.id);
  }
});

test("a key from a title never collides", () => {
  assert.equal(suggestKey("Plato, Republic"), "plato-republic");
  assert.equal(suggestKey("Πολιτεία"), "source", "no letters a key can use: a plain word");
  assert.equal(suggestKey("Émile, ou De l'éducation"), "emile-ou-de-l-education");
  assert.equal(suggestKey("Republic", ["republic"]), "republic-2");
  assert.equal(suggestKey("Republic", ["republic", "republic-2"]), "republic-3");
  assert.ok(suggestKey("x".repeat(200)).length <= 64);
  for (const title of ["", "!!!", "a--b", "  A  "]) assert.match(suggestKey(title, ["source"]), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("the advisory check names the first problem and the control that fixes it", () => {
  const sources = LIBRARY();
  const check = (changes, kind = "work") => validateSourceDraft(Object.assign(sourceDraft(null, kind), changes), sources);
  assert.equal(check({ id: "../x", title: "t" }).id, "sources.badKey");
  assert.equal(check({ id: "Upper", title: "t" }).field, "id");
  assert.equal(check({ id: "cave", title: "t" }).id, "sources.keyTaken");
  assert.deepEqual(check({ id: "w" }), { field: "title", id: "sources.needTitle" });
  assert.equal(check({ id: "e", title: "t" }, "edition").field, "of");
  assert.equal(check({ id: "t", title: "t", of: "plato-republic" }, "translation").field, "language");
  assert.equal(check({ id: "r", of: "cave", locationScheme: "page" }, "reference").field, "locationValue");
  assert.equal(check({ id: "ok", title: "t" }), null);
  assert.equal(validateSourceDraft(sourceDraft(sources[0]), sources), null, "an existing key is not a duplicate of itself");
  assert.equal(sourceDiagnosticControl("identifiers[0]"), "identifiers");
  assert.equal(sourceDiagnosticControl("location.scheme"), "locationValue");
  assert.equal(sourceDiagnosticControl("kind"), "kind-field");
  assert.equal(sourceDiagnosticControl("unheard"), "");
});

const PLAN = (counts, entries) => ({ counts: { create: 0, update: 0, unchanged: 0, conflict: 0, ...counts }, entries, diagnostics: [] });
const CREATE_ENTRY = { index: 0, cslId: "Plato-Republic", sourceId: "plato-republic", action: "create", changes: [], kept: [], unsupported: [{ field: "note", reason: "private notes and abstracts are never imported" }], diagnostics: [] };

test("import previews are summarised in her words, with kept and unsupported fields and every conflict", () => {
  assert.equal(sourceImportSummary(PLAN({ create: 2, update: 1, conflict: 1 })), "2 new, 1 updated, 1 can't be imported.");
  assert.equal(sourceImportSummary(PLAN({ unchanged: 3 })), "3 already here.");
  assert.equal(sourceImportSummary(PLAN({})), "Everything is already in your library.");
  const out = sourceImportRows(PLAN({ create: 1, update: 1, conflict: 2 }, [
    CREATE_ENTRY,
    { index: 1, cslId: "x", sourceId: "x", action: "update", changes: [{ field: "title" }], kept: ["of", "creators"], unsupported: [], diagnostics: [] },
    { index: 2, cslId: null, sourceId: null, action: "conflict", changes: [], kept: [], unsupported: [], diagnostics: [{ code: "missing-field", field: "id", message: "every item needs a non-empty `id`" }] },
    { index: 3, cslId: "Π", sourceId: "csl-0123", action: "conflict", changes: [], kept: [], unsupported: [], diagnostics: [{ code: "invalid-field", field: "URL", message: "must be an absolute HTTP(S) URL without credentials" }] },
  ]));
  assert.deepEqual(out[0], { action: "create", name: "plato-republic (from Plato-Republic)", details: ["Not kept: note: private notes and abstracts are never imported"], problems: [], problemDetails: [] });
  assert.deepEqual(out[1].details, ["Changes title", "Keeps of, creators as you wrote them"]);
  // Her layer says what's wrong by its code; the server's sentence (backticks, "credentials") is for the helper.
  assert.deepEqual([out[2].name, out[2].problems], ["Item 3", ["Can't be imported: something it needs is missing."]]);
  assert.deepEqual(out[3].problems, ["Can't be imported: something in it can't be used."]);
  assert.deepEqual(out[3].problemDetails, ["invalid-field: URL: must be an absolute HTTP(S) URL without credentials"]);
  for (const line of out.flatMap((r) => r.problems)) assert.doesNotMatch(line, /`|credentials|URL|id:/);
  assert.equal(out[3].name, "csl-0123 (from Π)");
  assert.deepEqual(sourceExportLossNotes([{ sourceId: "a", field: "kind" }, { sourceId: "a", field: "of" }, { sourceId: "b", field: "location" }, { sourceId: "a", field: "kind" }]), ["a: kind, of", "b: location"]);
  assert.deepEqual(sourceExportLossNotes(undefined), []);
});

test("names and rights read in her words, with no system word", () => {
  assert.equal(sourceLabel({ id: "x", kind: "edition", title: "  " }), "Untitled Edition (x)");
  assert.equal(sourceLabel({ id: "x", title: "Republic" }), "Republic");
  assert.equal(rightsText(null), "Not checked yet");
  assert.equal(rightsText({ status: "openLicense", license: "CC BY 4.0", note: "From the publisher" }), "Under an open licence, you say (CC BY 4.0). From the publisher");
  for (const status of ["unknown", "rightsReserved", "permission", "openLicense", "publicDomain", "ownWork"]) assert.doesNotMatch(rightsText({ status }), HER_BANNED);
});

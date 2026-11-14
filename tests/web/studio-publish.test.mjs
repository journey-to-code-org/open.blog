import { test } from "node:test";
import assert from "node:assert/strict";
import { sendOut, siteLink, wentOutWords } from "../../web/studio/parts/publish.js";
import { configureWords } from "../../web/studio/parts/words.js";

const api = (publish, post) => ({ get: async () => { if (publish instanceof Error) throw publish; return publish; }, post: async () => { if (post instanceof Error) throw post; return post; } });

test("sendOut says what really happened", async () => {
  assert.equal((await sendOut(api({ repo: false }))).sent, "none");
  assert.equal((await sendOut(api({ repo: true, remote: "" }))).sent, "none");
  assert.equal((await sendOut(api({ repo: true, remote: "origin", auto: true }))).sent, "auto");
  assert.deepEqual(await sendOut(api({ repo: true, remote: "origin" }, { pushed: true, commit: "abc", message: "ok", committed: ["a.md"] })), { sent: "pushed", message: "ok", commit: "abc", committed: ["a.md"] });
  assert.equal((await sendOut(api({ repo: true, remote: "origin" }, { pushed: false, message: "no network" }))).sent, "failed");
  assert.equal((await sendOut(api({ repo: true, remote: "origin" }, new Error("boom")))).message, "boom");
  assert.equal((await sendOut(api(new Error("down")))).sent, "none");
});

test("siteLink adds the site's base path and picks the right host", () => {
  const meta = { siteUrl: "https://mnichols08.github.io/grammis-house" };
  assert.equal(siteLink(meta, "/posts/stuffing/", { origin: "http://localhost:8789" }), "https://mnichols08.github.io/grammis-house/posts/stuffing/");
  assert.equal(siteLink(meta, "/posts/stuffing/", { local: true, origin: "http://localhost:8789" }), "http://localhost:8789/grammis-house/posts/stuffing/");
  assert.equal(siteLink(meta, "/grammis-house/posts/x/", { origin: "o" }), "https://mnichols08.github.io/grammis-house/posts/x/");
  assert.equal(siteLink({ siteUrl: "https://a.example/" }, "/p/", { origin: "o" }), "https://a.example/p/");
  assert.equal(siteLink({}, "/p/", { origin: "http://h" }), "http://h/p/");
  assert.equal(siteLink(meta, "", {}), "");
});

test("published here only: who sends it out is {helper}", () => {
  configureWords({ vars: { helper: "a friend" } });
  const meta = { siteUrl: "https://example.com" };
  assert.equal(wentOutWords({ sent: "none" }, { meta, origin: "http://127.0.0.1:9" }).words, "Published. Your public site catches up when a friend sends it out.");
  assert.equal(wentOutWords({ sent: "none" }, { meta, action: "takenOff", origin: "http://127.0.0.1:9" }).words, "It's a draft again. Your public site catches up when a friend sends it out.");
  configureWords();
});

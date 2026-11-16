// The picture that goes with a share (#656): which accounts take one, and what went wrong in her words.
import assert from "node:assert/strict";
import test from "node:test";
import { pictureTrouble, takesPicture } from "../../web/studio/parts/share-picture.js";
import { say } from "../../web/studio/parts/words.js";

test("Bluesky, LinkedIn and Facebook take a picture; other accounts don't", () => {
  for (const provider of ["bluesky", "linkedin", "facebook"]) assert.ok(takesPicture({ provider }), provider);
  for (const provider of ["mastodon", "youtube", "", undefined]) assert.ok(!takesPicture({ provider }), String(provider));
  assert.ok(!takesPicture(null));
});

test("a picture that can't be shown says why in her words, never the server's", () => {
  assert.equal(pictureTrouble({ status: 422, data: { code: "media-too-large" } }), say("picture.tooBig"));
  assert.equal(pictureTrouble({ status: 422, data: { code: "invalid-media", error: "The public cover and its description could not be previewed." } }), say("picture.none"));
  assert.equal(pictureTrouble({ status: 404, data: {} }), say("picture.notYet"));
  assert.equal(pictureTrouble({ status: 0 }), say("picture.trouble"));
});

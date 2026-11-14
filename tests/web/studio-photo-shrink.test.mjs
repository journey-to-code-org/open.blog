// Studio R4 Decided 2: photos are made smaller on the phone, and one it can't read is kept as it was.
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_SIDE, QUALITY, jpegName, shrinkPhoto, shrinkPlan, shrinks } from "../../web/studio/parts/photo-shrink.js";

test("the long side is at most 2000 px, the shape is kept, and nothing is made larger", () => {
  assert.equal(MAX_SIDE, 2000);
  assert.equal(QUALITY, 0.82);
  assert.deepEqual(shrinkPlan(4032, 3024), { width: 2000, height: 1500 });
  assert.deepEqual(shrinkPlan(3024, 4032), { width: 1500, height: 2000 });
  assert.deepEqual(shrinkPlan(800, 600), { width: 800, height: 600 });
  assert.deepEqual(shrinkPlan(10000, 3), { width: 2000, height: 1 });
  assert.equal(shrinkPlan(0, 100), null);
  assert.equal(shrinkPlan("x", 100), null);
});

test("a shrunk photo is a JPEG named after the original; a moving GIF or a non-picture is left alone", () => {
  assert.equal(jpegName("IMG_0042.HEIC"), "IMG_0042.jpg");
  assert.equal(jpegName(""), "photo.jpg");
  assert.equal(shrinks({ type: "image/jpeg" }), true);
  assert.equal(shrinks({ type: "image/heic" }), true);
  assert.equal(shrinks({ type: "image/gif" }), false);
  assert.equal(shrinks({ type: "application/pdf", name: "a.pdf" }), false);
  assert.equal(shrinks({ type: "", name: "IMG_1.HEIC" }), true);
});

test("drawn again at the planned size as a JPEG at 0.82, and the original when it can't be read", async () => {
  const file = new File([new Uint8Array(10)], "IMG_0042.HEIC", { type: "image/heic" });
  const drawn = [];
  let closed = false;
  class FakeCanvas {
    constructor(width, height) { this.size = [width, height]; }
    getContext() { return { fillRect() {}, set fillStyle(v) { drawn.push(v); }, drawImage: (_b, _x, _y, w, h) => drawn.push([w, h]) }; }
    async convertToBlob(options) { drawn.push(options); return new Blob(["jpeg"], { type: "image/jpeg" }); }
  }
  const env = { createImageBitmap: async () => ({ width: 4032, height: 3024, close: () => { closed = true; } }), OffscreenCanvas: FakeCanvas };
  const out = await shrinkPhoto(file, env);
  assert.equal(out.name, "IMG_0042.jpg");
  assert.equal(out.type, "image/jpeg");
  assert.deepEqual(drawn, ["#fff", [2000, 1500], { type: "image/jpeg", quality: 0.82 }]);
  assert.equal(closed, true);
  assert.equal(await shrinkPhoto(file, { createImageBitmap: async () => { throw new Error("can't decode"); } }), file);
  assert.equal(await shrinkPhoto(file, {}), file);
});

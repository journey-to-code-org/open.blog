import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PHOTO_BYTES, fieldError, fieldErrors, fitSize, photoError, photosFit, serverMessage,
} from "../../web/components/ob-quote-model.js";
import { MAX_PHOTO_BYTES as SERVER_PHOTO_BYTES, MAX_PHOTOS as SERVER_PHOTOS } from "../../netlify/lib/quote-intake.mjs";
import { validateRequest } from "../../netlify/lib/quote-intake.mjs";

const good = { name: "Pat", phone: "360 555 0142", email: "", town: "Bend, OR", service: "Fencing", description: "Replace the old fence." };

test("a complete request has no field problems", () => {
  assert.deepEqual(fieldErrors(good), {});
});

test("each problem is said in a sentence beside its field", () => {
  const errors = fieldErrors({ name: "", phone: "call", email: "x", town: "", service: "", description: "short" });
  assert.deepEqual(Object.keys(errors), ["name", "phone", "email", "town", "service", "description"]);
  for (const message of Object.values(errors)) assert.match(message, /^[A-Z].*\.$/);
});

test("the browser and the server agree on the same inputs", () => {
  const cases = [
    good,
    { ...good, phone: "12" },
    { ...good, email: "a@b" },
    { ...good, description: "see http://a.example http://b.example http://c.example please" },
    { ...good, name: " " },
  ];
  for (const values of cases) {
    const client = Object.keys(fieldErrors(values)).length === 0;
    let server = true;
    try {
      validateRequest({ fields: values, files: [] });
    } catch {
      server = false;
    }
    assert.equal(client, server, JSON.stringify(values));
  }
});

test("photo bounds match the hosted function", () => {
  assert.equal(MAX_PHOTO_BYTES, SERVER_PHOTO_BYTES);
  assert.equal(photoError(Array(SERVER_PHOTOS + 1).fill({ type: "image/jpeg", size: 1 })), `Choose at most ${SERVER_PHOTOS} photos.`);
  assert.match(photoError([{ type: "image/gif", size: 1 }]), /JPEG, PNG or WebP/);
  assert.equal(photoError([{ type: "image/png", size: 5_000_000 }]), "", "big photos are shrunk, not refused");
  assert.ok(photosFit([MAX_PHOTO_BYTES, 1]));
  assert.ok(!photosFit([MAX_PHOTO_BYTES + 1]));
});

test("pictures shrink to an edge and never grow", () => {
  assert.deepEqual(fitSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(fitSize(800, 600, 2000), { width: 800, height: 600 });
});

test("every server answer has words for the visitor", () => {
  for (const [status, code] of [[429, "token"], [429, "rate-limited"], [413, "too-large"], [422, "invalid"], [422, "token"], [409, "replayed"], [503, "storage-unavailable"], [0, ""], [403, "refused"]]) {
    assert.match(serverMessage(status, code), /\w/);
  }
  assert.match(serverMessage(503, "storage-unavailable"), /nothing was sent/);
  // A time-out (the Render relay's 504, or a platform's) or a lost connection may follow a saved
  // request, so the visitor is never told it was not saved (ADR 0388, #516).
  for (const [status, code] of [[504, "timeout"], [504, undefined], [502, "unconfirmed"], [0, undefined]]) {
    assert.doesNotMatch(serverMessage(status, code), /nothing was sent|could not save/i, `${status} ${code}`);
    assert.match(serverMessage(status, code), /may have been saved.*call us before you send it again/);
  }
  assert.equal(fieldError("email", ""), "");
});

test("the form's ADR says how it is checked, and axe-core is really what checks it", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const root = new URL("../../", import.meta.url);
  const adr = readdirSync(new URL("docs/adr/", root)).find((name) => name.startsWith("0382-"));
  const text = readFileSync(new URL(`docs/adr/${adr}`, root), "utf8").replace(/\s+/g, " ");
  const browser = JSON.parse(readFileSync(new URL("tests/browser/package.json", root), "utf8"));
  const spec = readFileSync(new URL("tests/browser/quote-form.spec.mjs", root), "utf8");
  assert.ok(browser.devDependencies["axe-core"], "axe-core is a dev dependency of the browser tests");
  assert.match(spec, /axe\.run\(/);
  assert.doesNotMatch(text, /axe is not a dependency/i);
  assert.match(text, /axe-core/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

test("workspace tests limit linker pressure and test artifact size on hosted runners", () => {
  assert.match(workflow, /cargo test --workspace -j 2/);
  assert.match(workflow, /CARGO_PROFILE_TEST_DEBUG:\s*0/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prepare = readFileSync(
  new URL("../../.github/workflows/prepare-scheduled-publisher.yml", import.meta.url),
  "utf8",
);
const publish = readFileSync(
  new URL("../../.github/workflows/netlify-schedule.yml", import.meta.url),
  "utf8",
);

test("main prepares a durable publisher binary for its exact commit", () => {
  assert.match(prepare, /push:\s*\n\s*branches: \[main\]/);
  assert.match(prepare, /schedule:\s*\n\s*- cron:/);
  assert.match(prepare, /cargo build --release -p openblog-cli --locked/);
  assert.match(prepare, /npm install --prefix \.scheduled-publisher\/deploy netlify-cli@26\.2\.0/);
  assert.match(prepare, /name: scheduled-publisher-linux-x64/);
  assert.match(prepare, /path: \.scheduled-publisher/);
  assert.match(prepare, /retention-days: 30/);
});

test("scheduled publishing reuses the exact main artifact and never compiles Rust", () => {
  assert.match(publish, /actions:\s*read/);
  assert.match(publish, /head_sha="\$GITHUB_SHA"/);
  assert.match(publish, /for attempt in \{1\.\.30\}/);
  assert.match(publish, /run-id: \$\{\{ steps\.publisher-run\.outputs\.run_id \}\}/);
  assert.match(publish, /\.scheduled-publisher\/openblog build/);
  assert.doesNotMatch(publish, /cargo (?:build|run)/);
  assert.doesNotMatch(publish, /NETLIFY_BUILD_HOOK/);
});

test("scheduled publishing deploys the generated site without a Netlify build", () => {
  assert.match(publish, /node \.scheduled-publisher\/deploy\/node_modules\/netlify-cli\/bin\/run\.js/);
  assert.doesNotMatch(publish, /npx /);
  assert.match(publish, /deploy --no-build --prod/);
  assert.match(publish, /--dir=dist/);
  assert.match(publish, /--functions=netlify\/functions/);
  assert.match(publish, /NETLIFY_AUTH_TOKEN: \$\{\{ secrets\.NETLIFY_AUTH_TOKEN \}\}/);
  assert.match(publish, /NETLIFY_SITE_ID: \$\{\{ secrets\.NETLIFY_SITE_ID \}\}/);
  assert.doesNotMatch(publish, /--auth=/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RUNNER_OUTPUT_BYTES,
  MAX_RUNNER_SOURCE_BYTES,
  MAX_RUNNER_STDIN_BYTES,
  runCode,
} from "../../web/components/ob-code-runner-client.js";

test("posts a bounded provider-neutral execution request without credentials", async () => {
  let request;
  const result = await runCode(
    { endpoint: "https://runner.example/v1/execute", language: "python", source: "print(input())", stdin: "hello\n" },
    {
      fetcher: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          headers: { get: () => "120" },
          json: async () => ({ success: true, stdout: "hello\n", stderr: "", exitCode: 0 }),
        };
      },
    },
  );

  assert.equal(request.url, "https://runner.example/v1/execute");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(request.options.body), {
    language: "python",
    source: "print(input())",
    stdin: "hello\n",
  });
  assert.deepEqual(result, { success: true, stdout: "hello\n", stderr: "", exitCode: 0 });
});

test("rejects unsafe endpoints, invalid languages, oversized input, and malformed output", async () => {
  const valid = { endpoint: "https://runner.example/execute", language: "python", source: "print(1)", stdin: "" };
  await assert.rejects(() => runCode({ ...valid, endpoint: "http://runner.example" }), /public HTTPS/);
  await assert.rejects(() => runCode({ ...valid, endpoint: "https://user:secret@runner.example" }), /public HTTPS/);
  await assert.rejects(() => runCode({ ...valid, language: "shell script" }), /language/);
  await assert.rejects(() => runCode({ ...valid, source: "x".repeat(MAX_RUNNER_SOURCE_BYTES + 1) }), /source/);
  await assert.rejects(() => runCode({ ...valid, stdin: "x".repeat(MAX_RUNNER_STDIN_BYTES + 1) }), /standard input/);
  await assert.rejects(() => runCode(valid, {
    fetcher: async () => ({ ok: true, headers: { get: () => "80" }, json: async () => ({ success: "yes", stdout: "", stderr: "" }) }),
  }), /unexpected response/);
});

test("strips terminal controls and truncates runner output", async () => {
  const result = await runCode(
    { endpoint: "https://runner.example/execute", language: "python", source: "print(1)", stdin: "" },
    {
      fetcher: async () => ({
        ok: true,
        headers: { get: () => "100" },
        json: async () => ({
          success: false,
          stdout: `\u001b[31m${"x".repeat(MAX_RUNNER_OUTPUT_BYTES + 100)}`,
          stderr: "ignored",
          exitCode: 1,
        }),
      }),
    },
  );
  assert.doesNotMatch(result.stdout, /\u001b/);
  assert.match(result.stdout, /output truncated by open\.blog/);
  assert.ok(new TextEncoder().encode(result.stdout).byteLength <= MAX_RUNNER_OUTPUT_BYTES);
  assert.equal(result.stderr, "");
});

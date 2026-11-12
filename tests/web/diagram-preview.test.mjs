import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { diagramFence, startDiagramRequest } from "../../web/admin/diagram-preview.js";

class FakeWorker {
  listeners = {};
  messages = [];
  terminated = false;
  addEventListener(type, listener) { this.listeners[type] = listener; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  send(data) { this.listeners.message({ data }); }
}

test("diagram work starts only after the worker loads and stops after the result", async () => {
  const worker = new FakeWorker();
  const request = startDiagramRequest({ type: "render", source: "flowchart LR" }, { workerFactory: () => worker });
  assert.deepEqual(worker.messages, []);
  worker.send({ type: "ready" });
  assert.equal(worker.messages[0].source, "flowchart LR");
  worker.send({ svg: "<svg/>" });
  assert.deepEqual(await request.promise, { svg: "<svg/>" });
  assert.equal(worker.terminated, true);
});

test("cancel, renderer errors and timeouts terminate the worker", async () => {
  const cancelled = new FakeWorker();
  const a = startDiagramRequest({ type: "render" }, { workerFactory: () => cancelled });
  a.cancel();
  await assert.rejects(a.promise, /cancelled/);
  assert.equal(cancelled.terminated, true);

  const failed = new FakeWorker();
  const b = startDiagramRequest({ type: "render" }, { workerFactory: () => failed });
  failed.send({ type: "ready" });
  failed.send({ error: "Invalid diagram", line: 3, column: 7 });
  await assert.rejects(b.promise, /Invalid diagram \(line 3, column 7\)/);
  assert.equal(failed.terminated, true);

  const stuck = new FakeWorker();
  const c = startDiagramRequest({ type: "render" }, { workerFactory: () => stuck, renderTimeout: 10 });
  stuck.send({ type: "ready" });
  await assert.rejects(c.promise, /time limit/);
  assert.equal(stuck.terminated, true);

  const loading = new FakeWorker();
  const d = startDiagramRequest({ type: "render" }, { workerFactory: () => loading, loadTimeout: 10 });
  await assert.rejects(d.promise, /too long to load/);
  assert.equal(loading.terminated, true);
});

test("diagram fences preserve source and quote options without breaking Markdown", () => {
  const result = diagramFence("flowchart LR\nA[`one ``` two`] --> B", {
    title: 'The "request"',
    description: "A request goes to B",
  });

  assert.equal(result.info, `mermaid title='The "request"' description="A request goes to B"`);
  assert.ok(result.markdown.startsWith("````mermaid "));
  assert.ok(result.markdown.endsWith("\n````"));
  assert.throws(() => diagramFence("", {}), /source/);
  assert.throws(() => diagramFence("A", { caption: `' " ` }), /quotation/);
  assert.throws(() => diagramFence("x".repeat(16385)), /16 KiB/);
});

test("the lazily loaded diagram module stays within the stated payload budgets", () => {
  const wasm = readFileSync(new URL("../../web/admin/diagram-wasm/openblog_wasm_bg.wasm", import.meta.url));
  assert.ok(wasm.length <= 12 * 1024 * 1024, `raw module: ${wasm.length} bytes`);
  const gzip = gzipSync(wasm, { level: 9 });
  assert.ok(gzip.length <= 4 * 1024 * 1024, `gzip module: ${gzip.length} bytes`);
});

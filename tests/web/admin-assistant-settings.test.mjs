import test from "node:test";
import assert from "node:assert/strict";

import { Editor } from "../../web/admin/admin.js";

test("provider settings load and replace a write-only credential without revealing it", async () => {
  const calls = [];
  let reads = 0;
  const app = {
    api: {
      call: async (method, path, request) => {
        calls.push({ method, path, request });
        if (method === "GET") {
          reads += 1;
          return {
            generationEndpoint: "https://assistant.example/generate",
            model: "writer-v1",
            etag: `revision-${reads}`,
            credential: { configured: true, source: "private" },
          };
        }
        return {
          generationEndpoint: request.json.generationEndpoint,
          model: request.json.model,
          etag: "revision-2",
          credential: { configured: true, source: "private" },
        };
      },
    },
  };
  const editor = new Editor(app, { kind: "posts", fields: {} });
  editor.ui = {
    assistantSettingsStatus: { textContent: "" },
    assistantSettingsEndpoint: { value: "" },
    assistantSettingsModel: { value: "" },
    assistantSettingsCredential: { value: "" },
    assistantSettingsSave: { disabled: false },
    assistantSettingsClear: { disabled: false },
  };
  editor.loadAssistantStatus = async () => {};

  await editor.loadAssistantSettings();
  assert.equal(editor.ui.assistantSettingsEndpoint.value, "https://assistant.example/generate");
  assert.equal(editor.ui.assistantSettingsModel.value, "writer-v1");
  assert.equal(editor.ui.assistantSettingsCredential.value, "");
  assert.match(editor.ui.assistantSettingsStatus.textContent, /private credential is saved/i);

  editor.ui.assistantSettingsCredential.value = "replacement-secret";
  await editor.saveAssistantSettings("save");
  assert.deepEqual(calls[1], {
    method: "PUT",
    path: "assistant/settings",
    request: {
      json: {
        generationEndpoint: "https://assistant.example/generate",
        model: "writer-v1",
        etag: "revision-1",
        credentialAction: "replace",
        credential: "replacement-secret",
      },
    },
  });
  assert.equal(editor.ui.assistantSettingsCredential.value, "");
  assert.equal(editor.ui.assistantSettingsSave.disabled, false);
  assert.equal(editor.ui.assistantSettingsClear.disabled, false);
});

test("environment precedence is announced and clearing never submits a credential", async () => {
  let submitted;
  const editor = new Editor(
    {
      api: {
        call: async (method, path, request) => {
          if (method === "PUT") submitted = request.json;
          return method === "GET"
            ? { generationEndpoint: "", model: "", etag: "revision-1", credential: { configured: true, source: "environment" } }
            : { etag: "revision-2", credential: { configured: true, source: "environment" } };
        },
      },
    },
    { kind: "posts", fields: {} },
  );
  editor.ui = {
    assistantSettingsStatus: { textContent: "" },
    assistantSettingsEndpoint: { value: "" },
    assistantSettingsModel: { value: "" },
    assistantSettingsCredential: { value: "must-not-be-sent" },
    assistantSettingsSave: { disabled: false },
    assistantSettingsClear: { disabled: false },
  };
  editor.loadAssistantStatus = async () => {};
  await editor.loadAssistantSettings();
  assert.match(editor.ui.assistantSettingsStatus.textContent, /environment credential takes precedence/i);
  await editor.saveAssistantSettings("clear");
  assert.equal(submitted.credentialAction, "clear");
  assert.equal("credential" in submitted, false);
});

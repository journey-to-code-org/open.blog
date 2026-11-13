import init, { diagramTemplates, renderDiagram } from "./diagram-wasm/openblog_wasm.js";

init().then(
  () => self.postMessage({ type: "ready" }),
  (error) => self.postMessage({ type: "error", error: `Diagram preview could not load: ${String(error)}` }),
);

self.addEventListener("message", ({ data }) => {
  try {
    if (data.type === "templates") {
      self.postMessage({ templates: JSON.parse(diagramTemplates()) });
    } else if (data.type === "render") {
      self.postMessage(JSON.parse(renderDiagram(data.info, data.source, 1)));
    } else {
      throw new Error("Unknown diagram preview request.");
    }
  } catch (error) {
    self.postMessage({ error: `Diagram preview could not run: ${String(error)}` });
  }
});

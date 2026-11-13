// Each request gets a worker so cancelling or timing out stops even non-cooperative rendering.
export function startDiagramRequest(request, {
  workerFactory = () => new Worker(new URL("./diagram-worker.js", import.meta.url), { type: "module" }),
  loadTimeout = 15000,
  renderTimeout = 2000,
} = {}) {
  const worker = workerFactory();
  let finish;
  const promise = new Promise((resolve, reject) => {
    let timer;
    let done = false;
    finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const expire = (message, milliseconds) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error(message)), milliseconds);
    };
    expire("Diagram preview took too long to load.", loadTimeout);
    worker.addEventListener("error", (event) => finish(new Error(`Diagram preview failed: ${event.message}`)));
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "ready") {
        expire("Diagram preview exceeded its time limit.", renderTimeout);
        try {
          worker.postMessage(request);
        } catch (error) {
          finish(new Error(`Diagram preview could not start: ${String(error)}`));
        }
      } else if (data.error) {
        const location = Number.isSafeInteger(data.line) && data.line > 1
          && Number.isSafeInteger(data.column) && data.column > 0
          ? ` (line ${data.line}, column ${data.column})`
          : "";
        finish(new Error(`${data.error}${location}`));
      } else {
        finish(null, data);
      }
    });
  });
  return { promise, cancel: () => finish(new Error("Diagram preview was cancelled.")) };
}

export function diagramFence(source, { title = "", description = "", caption = "" } = {}) {
  if (!source.trim()) throw new Error("Write diagram source before inserting it.");
  if (new TextEncoder().encode(source).length > 16384) throw new Error("Diagram source must be at most 16 KiB.");
  const options = [];
  for (const [name, raw] of [["title", title], ["description", description], ["caption", caption]]) {
    const value = raw.trim();
    if (!value) continue;
    if (/[\r\n\x00-\x1f]/.test(value) || new TextEncoder().encode(value).length > 1024) {
      throw new Error(`${name} must be a single line of at most 1024 bytes.`);
    }
    const quote = value.includes('"') ? "'" : '"';
    if (value.includes(quote)) throw new Error(`${name} cannot contain both kinds of quotation mark.`);
    options.push(`${name}=${quote}${value}${quote}`);
  }
  const info = ["mermaid", ...options].join(" ");
  const longest = Math.max(2, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(longest + 1);
  return { info, markdown: `${marker}${info}\n${source.replace(/\n*$/, "")}\n${marker}` };
}

// The Readers area has one navigation item and three places: what readers sent (`#/readers`,
// `#/readers/<view>`), Visitors (`#/readers/visitors[/<days>]`) and How readers reach you
// (`#/readers/setup`). Studio R10.
import { createReaders } from "./readers.js";
import { createVisitors } from "./visitors.js";
import { createReaderSetup } from "./reader-setup.js";
import { rangeOf } from "../parts/visitor-rules.js";

export function createReadersArea(context, route) {
  const [first = "", second = ""] = String(route.arg || "").split("/");
  if (first === "visitors") return createVisitors(context, rangeOf(second));
  if (first === "setup") return createReaderSetup(context, route);
  return createReaders(context, route);
}

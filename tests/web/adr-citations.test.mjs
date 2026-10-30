// Every ADR number cited in a comment of the Netlify functions and their libraries names a
// decision record that exists under docs/adr, so a reader following a citation lands on it and the
// merge-time renumbering of a lane's ADRs has a file behind every number it rewrites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const adrNumbers = new Set(
  readdirSync(join(root, "docs/adr"))
    .map((name) => name.match(/^(\d{4})-/)?.[1])
    .filter(Boolean),
);

function sources(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(rel);
    return /\.(mjs|js)$/.test(entry.name) ? [rel] : [];
  });
}

// "ADR 0763", "ADRs 0762 and 0763", "ADRs 0319 to\n// 0321": numbers after ADR/ADRs, joined by
// commas, "and", "to" or a hyphen, possibly across a wrapped comment line.
const CITATION = /\bADRs?\s+(\d{4}(?:(?:\s|\/\/|,|and|to|-)+\d{4})*)/g;

export function citedAdrs(text) {
  const cited = [];
  for (const match of text.matchAll(CITATION)) {
    const parts = match[1];
    const numbers = parts.match(/\d{4}/g);
    cited.push(...numbers);
    for (const range of parts.matchAll(/(\d{4})(?:\s|\/\/)+to(?:\s|\/\/)+(\d{4})/g)) {
      for (let n = Number(range[1]) + 1; n < Number(range[2]); n += 1) {
        cited.push(String(n).padStart(4, "0"));
      }
    }
  }
  return cited;
}

test("the citation reader takes single numbers, lists and ranges, across wrapped comments", () => {
  assert.deepEqual(citedAdrs("// story #392, ADR 0763)"), ["0763"]);
  assert.deepEqual(citedAdrs("// ADRs 0762 and 0763"), ["0762", "0763"]);
  assert.deepEqual(citedAdrs("// ADRs 0319 to\n// 0321;"), ["0319", "0321", "0320"]);
});

test("every ADR cited in the Netlify sources has a decision record", () => {
  const missing = [];
  for (const file of [...sources("netlify/lib"), ...sources("netlify/functions")]) {
    const text = readFileSync(join(root, file), "utf8");
    for (const number of citedAdrs(text)) {
      if (!adrNumbers.has(number)) missing.push(`${file}: ADR ${number}`);
    }
  }
  assert.deepEqual(missing, []);
});

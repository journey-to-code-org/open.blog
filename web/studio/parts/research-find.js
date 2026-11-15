// What Find lists for research (Studio R11): always the developer's door, "Start research (for
// {helper})"; on a site that uses research (G92), each research screen and job by name. A site
// that doesn't use research gets that one entry and nothing else.
import { say } from "./words.js";
import { researchUsed } from "./research-rules.js";

export function researchFind(meta) {
  const start = { id: "research-start", label: say("research.findStart"), group: "Go to", href: "#/research" };
  // R13: Readings side by side, on any site that has one.
  const readings = meta?.siteUses?.readings === true ? [{ id: "go-research-readings", label: say("readings.findList"), group: "Go to", href: "#/research/readings" }] : [];
  if (!researchUsed(meta)) return [start, ...readings];
  return [
    ...readings,
    start,
    { id: "go-research-sources", label: say("research.tabSources"), group: "Go to", href: "#/research/sources" },
    { id: "research-add-source", label: say("sources.add"), group: "Do", href: "#/research/sources?new=1" },
    { id: "go-research-notebook", label: say("research.tabNotebook"), group: "Go to", href: "#/research/notebook" },
    { id: "research-keep-passage", label: say("notebook.newPassage"), group: "Do", href: "#/research/notebook?new=passage" },
    { id: "research-write-note", label: say("notebook.newNote"), group: "Do", href: "#/research/notebook?new=note" },
    { id: "research-search", label: say("notebook.search"), group: "Do", href: "#/research/notebook?search=1" },
    { id: "research-import", label: say("sources.importTitle"), group: "Do", href: "#/research/sources?import=1" },
    { id: "research-export", label: say("sources.exportTitle"), group: "Do", href: "#/research/sources?export=1" },
    { id: "research-copy", label: say("notebook.copyOpen"), group: "Do", href: "#/research/notebook?copy=1" },
    { id: "go-research-atlas", label: say("research.tabAtlas"), group: "Go to", href: "#/research/atlas" },
    { id: "research-add-entry", label: say("atlas.add"), group: "Do", href: "#/research/atlas?new=1" },
    { id: "go-research-chronology", label: say("atlas.chronology"), group: "Go to", href: "#/research/atlas/chronology" },
    { id: "go-research-compare", label: say("research.tabCompare"), group: "Go to", href: "#/research/compare" },
    { id: "go-research-public", label: say("research.tabPublic"), group: "Go to", href: "#/research/public" },
  ];
}

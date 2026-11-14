// The two kinds of record a trade site keeps, in her words: services (`services/*.md`) and customer
// reviews (`proof/*.md`). Shaped like doc-kinds.js entries, so the list screen (documents.js) shows
// them as it shows pages, plus a line under each row (`row`) and the server's order (`sort`). Each
// names the old Admin model the editor (record-edit.js) uses for its rules. Studio slice 10a.

import * as services from "./services-rules.js";
import * as proof from "./proof-rules.js";

const STARS = (rating) => (/^[1-5]$/.test(String(rating || "")) ? Number(rating) : 0);
const PLATFORM_WORDS = { google: "Google", facebook: "Facebook", nextdoor: "Nextdoor", yelp: "Yelp", houzz: "Houzz", angi: "Angi", other: "Somewhere else" };

/** "October 20, 2026" from "2026-10-20", or "". */
export function longDay(value) {
  const date = new Date(`${String(value || "").slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** A review's line in the list: "5 stars · Google · October 20, 2026". Exported for tests. */
export function reviewLine(item) {
  const stars = STARS(item.rating);
  return [stars ? `${stars} star${stars === 1 ? "" : "s"}` : "", PLATFORM_WORDS[item.platform] || "", longDay(item.date)].filter(Boolean).join(" · ");
}

export const RECORDS = {
  services: {
    kind: "services",
    list: "services",
    edit: "service",
    one: "service",
    many: "services",
    heading: "Your services",
    lede: (n) => (n === 1 ? "1 service on your site" : `${n} services on your site`),
    about: "Each service gets its own page, with what's included and the questions people ask. A job can say which service it was.",
    add: "Add a service",
    empty: "Start with the work you're asked for most, like a roof repair.",
    newTitle: "New service",
    model: services,
    sort: "title",
    row: (item) => (item.status === "draft" ? "Off your site" : ""),
    preview: true,
  },
  proof: {
    kind: "proof",
    list: "reviews",
    edit: "review",
    one: "review",
    many: "reviews",
    heading: "Your reviews",
    lede: (n) => (n === 1 ? "1 review from a customer" : `${n} reviews from customers`),
    about: "Save real reviews customers left you, with the link to where they left them. They go on your Reviews page, and beside the job they're about.",
    add: "Add a review",
    empty: "Paste the link to a review a customer left you on Google or Facebook, and Studio copies it in.",
    newTitle: "New review",
    model: proof,
    sort: "server",
    row: (item) => [reviewLine(item), item.status === "draft" ? "Off your site" : ""].filter(Boolean).join(" · "),
    preview: false,
  },
};

/** A trade site (meta.siteUses.trade): Business, Services and Reviews show for it, and only for it. */
export const tradeSite = (meta) => meta?.siteUses?.trade === true;

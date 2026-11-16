// Every screen in one place: its route name, whether it's in the navigation (and as what), which
// navigation item it belongs under, when it applies (`when(meta)`, default always), and how to make
// it. Adding a screen is one entry here.
import { createHome } from "./home.js";
import { createPosts } from "./posts.js";
import { createWrite } from "./write.js";
import { createPictures } from "./pictures.js";
import { createDecorations } from "./decorations.js";
import { createGifts } from "./gifts.js";
import { createDocuments } from "./documents.js";
import { createPageEdit } from "./page-edit.js";
import { createLanding } from "./landing.js";
import { createLook } from "./look.js";
import { createReadersArea } from "./readers-area.js";
import { createCards } from "./cards.js";
import { createCardEdit } from "./card-edit.js";
import { createBusiness } from "./business.js";
import { createRecordEdit } from "./record-edit.js";
import { RECORDS, tradeSite } from "../parts/record-kinds.js";
import { createQuotes } from "./quotes.js";
import { createReminders } from "./reminders.js";
import { createSharing } from "./sharing.js";
import { createShareNew } from "./share-new.js";
import { createJobShare } from "./job-share.js";
import { createAccounts } from "./accounts.js";
import { createNotifications } from "./notifications.js";
import { KINDS } from "../parts/doc-kinds.js";
import { createNewPost, hasRecipes } from "./new-post.js";
import { createNewJob } from "./new-job.js";
import { createPeople } from "./people.js";
import { createHelper } from "./helper.js";
import { createVoiceHub } from "./voice.js";
import { createVoiceWriteScreen } from "./voice-write.js";
import { createVoicePieceScreen } from "./voice-piece.js";
import { createVoiceGuideScreen } from "./voice-guide.js";
import { createDesign } from "./design.js";
import { createStart } from "./start.js";
import { createPaths } from "./paths.js";
import { createPathEdit } from "./path-edit.js";
import { createReadings } from "./readings.js";
import { createReadingEdit } from "./reading-edit.js";
import { createResearchHome } from "./research.js";
import { createSources } from "./sources.js";
import { createNotebook } from "./notebook.js";
import { createAtlas } from "./atlas.js";
import { createCompare } from "./compare.js";
import { createResearchPublic } from "./research-public.js";
import { researchUsed } from "../parts/research-rules.js";
import { createTogetherScreen } from "./together.js";
import { createWelcome } from "./welcome.js";
import { createWhatYouUse } from "./what-you-use.js";
import { createStories } from "./stories.js";
import { say } from "../parts/words.js";
import { areaVisible } from "../parts/area-rules.js";

export const SCREENS = [
  { name: "home", nav: "Home", area: "home", create: (context) => createHome(context) },
  { name: "posts", nav: "Posts", area: "posts", create: (context) => createPosts(context) },
  // R11: Research. Its address always opens (the developer's door is Find › Start research); the
  // navigation shows it only on a site that uses research (G92). #/research is home,
  // #/research/sources[/<key>] the library, #/research/notebook[/<id>] the notebook; R12 adds
  // #/research/atlas[/…], #/research/compare[/<id>] and #/research/public.
  // R13 adds Readings side by side under #/research/readings (list), #/research/readings/new and
  // #/research/reading/<address> (editor); a site with readings and no other research still gets the door.
  { name: "research", get nav() { return say("research.nav"); }, area: "research", navWhen: (meta) => researchUsed(meta) || meta.siteUses?.readings === true,
    create: (context, route) => (/^readings\/new$/.test(route.arg) ? createReadingEdit(context, { ...route, arg: "new" })
      : /^readings$/.test(route.arg) ? createReadings(context)
      : /^reading\/./.test(route.arg) ? createReadingEdit(context, { ...route, arg: route.arg.slice("reading/".length) })
      : !route.arg && !researchUsed(context.meta) && context.meta?.siteUses?.readings === true ? createReadings(context)
      : /^atlas(\/|$)/.test(route.arg) ? createAtlas(context, route)
      : /^compare(\/|$)/.test(route.arg) ? createCompare(context, route)
      : /^public(\/|$)/.test(route.arg) ? createResearchPublic(context, route)
      : /^sources(\/|$)/.test(route.arg) ? createSources(context, route)
      : /^notebook(\/|$)/.test(route.arg) ? createNotebook(context, route)
        : createResearchHome(context, route)) },
  // R4: a job from the site. Always present (an old Capture link, or something waiting on a phone,
  // never lands on a blank Home); in the navigation on a trade site.
  { name: "new-job", nav: "New job", area: "jobs", navWhen: tradeSite, create: (context, route) => createNewJob(context, route) },
  { name: "pages", nav: "Pages", area: "pages", create: (context) => createDocuments(context, KINDS.pages) },
  { name: "page", area: "pages", create: (context, route) => createPageEdit(context, KINDS.pages, route.arg) },
  { name: "collections", nav: "Collections", area: "collections", create: (context) => createDocuments(context, KINDS.series) },
  { name: "collection", area: "collections", create: (context, route) => createPageEdit(context, KINDS.series, route.arg) },
  // R13: reading paths. In the navigation once the site has one (meta.siteUses.paths); always routable, so an old
  // address and Find ("Make a reading path") reach them. #/paths/new and #/path/<address> are the editor.
  { name: "paths", nav: () => say("paths.nav"), area: "paths", navWhen: (meta) => meta.siteUses?.paths === true, create: (context, route) => (route.arg === "new" ? createPathEdit(context, route) : createPaths(context)) },
  { name: "path", area: "paths", create: (context, route) => createPathEdit(context, route) },
  { name: "front-page", nav: "Front page", area: "front-page", create: (context) => createLanding(context) },
  // R10: Readers (what readers sent, Visitors, How readers reach you). In the navigation when comments are
  // set up or there are visitor numbers; always routable, so an old address and Find reach How readers reach you.
  { name: "readers", nav: "Readers", area: "readers", navWhen: (meta) => meta.engagementSetUp === true || meta.engagement === true || Boolean(meta.visitors), create: (context, route) => createReadersArea(context, route) },
  // Only when greeting cards are set up where Admin runs (OPENBLOG_GREETINGS_*). #/cards/new and
  // #/cards/<id> are the editor.
  { name: "cards", nav: "Cards", area: "cards", when: (meta) => meta.greetings === true, create: (context, route) => (route.arg ? createCardEdit(context, route) : createCards(context)) },
  // A trade site's own (meta.siteUses.trade): services, reviews and the business facts.
  { name: "services", nav: "Services", area: "services", when: tradeSite, create: (context) => createDocuments(context, RECORDS.services) },
  { name: "service", area: "services", when: tradeSite, create: (context, route) => createRecordEdit(context, RECORDS.services, route.arg) },
  { name: "reviews", nav: "Reviews", area: "reviews", when: tradeSite, create: (context) => createDocuments(context, RECORDS.proof) },
  { name: "review", area: "reviews", when: tradeSite, create: (context, route) => createRecordEdit(context, RECORDS.proof, route.arg) },
  // Business facts open on any site (the account menu and Find), so a trade site can be started; the nav
  // shows them only on a trade site.
  { name: "business", nav: "Business", area: "business", navWhen: tradeSite, create: (context) => createBusiness(context) },
  // Each only when it applies: the quote form is set up, reminders are for this trade, sharing is set up.
  { name: "quotes", nav: "Requests", area: "quotes", when: (meta) => meta.quote === true, create: (context) => createQuotes(context) },
  { name: "reminders", nav: "Reminders", area: "reminders", when: (meta) => meta.siteUses?.reminders === true, create: (context) => createReminders(context) },
  // #/sharing/new is the composer; #/sharing/accounts is Your accounts (R2: connect, reconnect,
  // disconnect; only "not set up" when sharing isn't); #/sharing/job/<path> shares one finished job; ?view=posts is
  // "Where each post went", which a site that shared something has even without accounts (G16).
  // Share this job opens on any trade site (the checklist's last step); the nav item only once
  // there's something to show.
  { name: "sharing", nav: "Sharing", area: "sharing", when: (meta) => meta.social === true || meta.siteUses?.shared === true || meta.siteUses?.trade === true,
    navWhen: (meta) => meta.social === true || meta.siteUses?.shared === true,
    create: (context, route) => (route.arg === "new" && context.meta.social === true ? createShareNew(context, route)
      : route.arg === "accounts" ? createAccounts(context, route)
        : route.arg.startsWith("job/") ? createJobShare(context, route.arg.slice(4), route)
        : createSharing(context, route)) },
  // R3: the phone in her hand, not in the navigation (account menu, Find, and the quiet link on
  // Comments and Requests). Always present, so an old link never lands on a blank Home; with no
  // push settings it says "not set up". ?sheet=home-screen opens Add to Home Screen.
  { name: "notifications", area: "notifications", create: (context, route) => createNotifications(context, route) },
  // R5: who can be named on her posts (the old Contributors). Not in the navigation: reached from
  // Who wrote it on any post, and from Find. ?from=<post>&add=1 returns to that post.
  { name: "people", area: "people", create: (context, route) => createPeople(context, route) },
  // R8: the writing helper's setup and what it knows. Not in the navigation: the account menu,
  // Find, and the sheet in Write. ?setup=1 opens Connection.
  { name: "helper", area: "helper", create: (context, route) => createHelper(context, route) },
  // R9: Your writing voice. Not in the navigation: the Writing helper screen, Home's invitation
  // and Find. #/voice is the hub, #/voice/write[?pack=] a piece against the clock,
  // #/voice/piece/<id> one piece, #/voice/guide the voice guide.
  { name: "voice", area: "voice", create: (context, route) => (route.arg === "write" ? createVoiceWriteScreen(context, route)
    : route.arg === "guide" ? createVoiceGuideScreen(context, route)
      : route.arg.startsWith("piece/") ? createVoicePieceScreen(context, route.arg.slice(6))
        : createVoiceHub(context)) },
  // R9b: Getting started. #/start is the step she is on; #/start/helper|stories|voice|done each
  // step. `chrome: "focus"` hides the navigation and Find (the account menu stays).
  { name: "start", area: "start", chrome: "focus", create: (context, route) => createStart(context, route) },
  // ONB1: About your blog, the opening of a Getting started run (and Ask me the questions again);
  // #/welcome/<question>|summary|suggestions|voice. What you use is where she changes her mind.
  { name: "welcome", area: "start", chrome: "focus", create: (context, route) => createWelcome(context, route) },
  { name: "what-you-use", area: "what-you-use", create: (context) => createWhatYouUse(context) },
  // ONB1.7: My stories, from Your writing voice, Write and Find.
  { name: "stories", area: "voice", create: (context) => createStories(context) },
  // R14a: Writing together. In the navigation once she takes part in one (G111), and for a co-writer
  // sign-in the only screen there is (`coWriter`), and its Home. #/together/new, /join, /<id>,
  // /<id>/write and /<id>/read are its screens.
  { name: "together", nav: (meta) => togetherNav(meta), area: "together", coWriter: true,
    navWhen: (meta) => meta.account === "co-writer" || meta.together?.takingPart > 0, create: (context, route) => createTogetherScreen(context, route) },
  // An old Admin address for something Studio doesn't do yet (router.js legacyRoute).
  { name: "pictures", nav: "Pictures", area: "pictures", create: (context) => createPictures(context) },
  // R9: #/look/design is Describe a new look (Look's navigation item stays current).
  { name: "look", nav: "Look", area: "look", create: (context, route) => (route.arg === "design" ? createDesign(context) : createLook(context)) },
  { name: "decorations", nav: "Decorations", area: "decorations", create: (context) => createDecorations(context) },
  // Only when gifts are set up where Admin runs (OPENBLOG_GIFTS_*).
  { name: "gifts", nav: "Gifts", area: "gifts", when: (meta) => meta.gifts === true, create: (context) => createGifts(context) },
  // #/write asks "a recipe or a story?" (when the site has recipes); #/write/new/recipe|story starts
  // one; #/write/<path> opens a post.
  // #/write asks what she's writing (recipes on, or a trade site with jobs: R4); #/write/new/job
  // starts a job at a desk.
  { name: "write", area: "posts", create: (context, route) => (route.arg === "" && (hasRecipes(context.meta) || (tradeSite(context.meta) && areaVisible(context.meta, "trade"))) ? createNewPost(context) : createWrite(context, route.arg, route)) },
];

/** "Writing together", with how many are waiting on her. */
function togetherNav(meta) {
  const waiting = Number(meta?.together?.waitingOnYou || 0);
  return waiting > 0 ? `${say("together.nav")} · ${say("together.waitingBadge", { n: waiting })}` : say("together.nav");
}

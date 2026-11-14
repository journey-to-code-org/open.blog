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
import { createTools } from "./tools.js";
import { createLanding } from "./landing.js";
import { createLook } from "./look.js";
import { createComments } from "./comments.js";
import { createCards } from "./cards.js";
import { createCardEdit } from "./card-edit.js";
import { createVisitors } from "./visitors.js";
import { createBusiness } from "./business.js";
import { createRecordEdit } from "./record-edit.js";
import { RECORDS, tradeSite } from "../parts/record-kinds.js";
import { createQuotes } from "./quotes.js";
import { createReminders } from "./reminders.js";
import { createSharing } from "./sharing.js";
import { createShareNew } from "./share-new.js";
import { createJobShare } from "./job-share.js";
import { createAccounts } from "./accounts.js";
import { createNotYet } from "./not-yet.js";
import { createNotifications } from "./notifications.js";
import { KINDS } from "../parts/doc-kinds.js";
import { createNewPost, hasRecipes } from "./new-post.js";
import { createNewJob } from "./new-job.js";

export const SCREENS = [
  { name: "home", nav: "Home", area: "home", create: (context) => createHome(context) },
  { name: "posts", nav: "Posts", area: "posts", create: (context) => createPosts(context) },
  // R4: a job from the site. Always present (an old Capture link, or something waiting on a phone,
  // never lands on a blank Home); in the navigation on a trade site.
  { name: "new-job", nav: "New job", area: "jobs", navWhen: tradeSite, create: (context, route) => createNewJob(context, route) },
  { name: "pages", nav: "Pages", area: "pages", create: (context) => createDocuments(context, KINDS.pages) },
  { name: "page", area: "pages", create: (context, route) => createPageEdit(context, KINDS.pages, route.arg) },
  { name: "collections", nav: "Collections", area: "collections", create: (context) => createDocuments(context, KINDS.series) },
  { name: "collection", area: "collections", create: (context, route) => createPageEdit(context, KINDS.series, route.arg) },
  { name: "front-page", nav: "Front page", area: "front-page", create: (context) => createLanding(context) },
  // Only when comments are on and the hosted key is in place where Admin runs.
  { name: "comments", nav: "Comments", area: "comments", when: (meta) => meta.engagement === true || meta.engagementSetUp === true, create: (context, route) => createComments(context, route) },
  // Only when greeting cards are set up where Admin runs (OPENBLOG_GREETINGS_*). #/cards/new and
  // #/cards/<id> are the editor.
  { name: "cards", nav: "Cards", area: "cards", when: (meta) => meta.greetings === true, create: (context, route) => (route.arg ? createCardEdit(context, route) : createCards(context)) },
  // Only when there are visitor numbers to show (meta.visitors: the hosted or the built-in counter).
  { name: "visitors", nav: "Visitors", area: "visitors", when: (meta) => Boolean(meta.visitors), create: (context, route) => createVisitors(context, route) },
  // A trade site's own (meta.siteUses.trade): services, reviews and the business facts.
  { name: "services", nav: "Services", area: "services", when: tradeSite, create: (context) => createDocuments(context, RECORDS.services) },
  { name: "service", area: "services", when: tradeSite, create: (context, route) => createRecordEdit(context, RECORDS.services, route.arg) },
  { name: "reviews", nav: "Reviews", area: "reviews", when: tradeSite, create: (context) => createDocuments(context, RECORDS.proof) },
  { name: "review", area: "reviews", when: tradeSite, create: (context, route) => createRecordEdit(context, RECORDS.proof, route.arg) },
  // Business facts open on any site (More tools and Find), so a trade site can be started; the nav
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
  // An old Admin address for something Studio doesn't do yet (router.js legacyRoute).
  { name: "not-yet", create: (context, route) => createNotYet(context, route) },
  { name: "pictures", nav: "Pictures", area: "pictures", create: (context) => createPictures(context) },
  { name: "look", nav: "Look", area: "look", create: (context) => createLook(context) },
  { name: "decorations", nav: "Decorations", area: "decorations", create: (context) => createDecorations(context) },
  // Only when gifts are set up where Admin runs (OPENBLOG_GIFTS_*).
  { name: "gifts", nav: "Gifts", area: "gifts", when: (meta) => meta.gifts === true, create: (context) => createGifts(context) },
  // The old Admin's other tools, by link (account menu and Find).
  { name: "tools", area: "tools", create: () => createTools() },
  // #/write asks "a recipe or a story?" (when the site has recipes); #/write/new/recipe|story starts
  // one; #/write/<path> opens a post.
  { name: "write", area: "posts", create: (context, route) => (route.arg === "" && hasRecipes(context.meta) ? createNewPost(context) : createWrite(context, route.arg)) },
];

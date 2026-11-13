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
import { KINDS } from "../parts/doc-kinds.js";
import { createNewPost, hasRecipes } from "./new-post.js";

export const SCREENS = [
  { name: "home", nav: "Home", area: "home", create: (context) => createHome(context) },
  { name: "posts", nav: "Posts", area: "posts", create: (context) => createPosts(context) },
  { name: "pages", nav: "Pages", area: "pages", create: (context) => createDocuments(context, KINDS.pages) },
  { name: "page", area: "pages", create: (context, route) => createPageEdit(context, KINDS.pages, route.arg) },
  { name: "collections", nav: "Collections", area: "collections", create: (context) => createDocuments(context, KINDS.series) },
  { name: "collection", area: "collections", create: (context, route) => createPageEdit(context, KINDS.series, route.arg) },
  { name: "front-page", nav: "Front page", area: "front-page", create: (context) => createLanding(context) },
  // Only when comments are on and the hosted key is in place where Admin runs.
  { name: "comments", nav: "Comments", area: "comments", when: (meta) => meta.engagement === true, create: (context, route) => createComments(context, route) },
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

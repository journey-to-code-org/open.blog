// Every screen in one place: its route name, whether it's in the navigation (and as what), which
// navigation item it belongs under, when it applies (`when(meta)`, default always), and how to make
// it. Adding a screen is one entry here.
import { createHome } from "./home.js";
import { createPosts } from "./posts.js";
import { createWrite } from "./write.js";
import { createPictures } from "./pictures.js";
import { createDecorations } from "./decorations.js";
import { createGifts } from "./gifts.js";
import { createNewPost, hasRecipes } from "./new-post.js";

export const SCREENS = [
  { name: "home", nav: "Home", area: "home", create: (context) => createHome(context) },
  { name: "posts", nav: "Posts", area: "posts", create: (context) => createPosts(context) },
  { name: "pictures", nav: "Pictures", area: "pictures", create: (context) => createPictures(context) },
  { name: "decorations", nav: "Decorations", area: "decorations", create: (context) => createDecorations(context) },
  // Only when gifts are set up where Admin runs (OPENBLOG_GIFTS_*).
  { name: "gifts", nav: "Gifts", area: "gifts", when: (meta) => meta.gifts === true, create: (context) => createGifts(context) },
  // #/write asks "a recipe or a story?" (when the site has recipes); #/write/new/recipe|story starts
  // one; #/write/<path> opens a post.
  { name: "write", area: "posts", create: (context, route) => (route.arg === "" && hasRecipes(context.meta) ? createNewPost(context) : createWrite(context, route.arg)) },
];

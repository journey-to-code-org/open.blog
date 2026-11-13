// Every screen in one place: its route name, whether it's in the navigation (and as what), which
// navigation item it belongs under, and how to make it. Adding a screen is one entry here.
import { createHome } from "./home.js";
import { createPosts } from "./posts.js";
import { createWrite } from "./write.js";

export const SCREENS = [
  { name: "home", nav: "Home", area: "home", create: (context) => createHome(context) },
  { name: "posts", nav: "Posts", area: "posts", create: (context) => createPosts(context) },
  { name: "write", area: "posts", create: (context, route) => createWrite(context, route.arg) },
];

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { adminTarget, createSite, parseRedirects } from "../../service/site.mjs";
import { createService } from "../../service/server.mjs";

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};

test("only exact redirects are taken from _redirects", () => {
  const { rules, skipped } = parseRedirects("# old\n/old/ /new/ 301\n/a /b\n/x/* /y/:splat 301\n/c /d 200\n");
  assert.deepEqual([...rules], [["/old/", { to: "/new/", status: 301 }], ["/a", { to: "/b", status: 301 }]]);
  assert.equal(skipped, 2);
});

test("/admin goes to the editor", () => {
  const editor = "https://editor.example/admin/";
  assert.equal(adminTarget(editor, "/admin"), "https://editor.example/admin/");
  assert.equal(adminTarget(editor, "/admin/studio/", "?x=1"), "https://editor.example/admin/studio/?x=1");
  assert.equal(adminTarget(editor, "/administer"), null);
  assert.equal(adminTarget("", "/admin"), null);
});

test("the site: pages, folders, redirects, feeds open to all, 404, revalidation, no escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "site-"));
  await mkdir(join(root, "posts", "pie"), { recursive: true });
  await mkdir(join(root, "api"));
  await writeFile(join(root, "index.html"), "<h1>home</h1>");
  await writeFile(join(root, "posts", "pie", "index.html"), "<h1>pie</h1>");
  await writeFile(join(root, "404.html"), "<h1>missing</h1>");
  await writeFile(join(root, "rss.xml"), "<rss/>");
  await writeFile(join(root, "api", "blog.json"), "[]");
  await writeFile(join(root, "_redirects"), "/old-pie/ /posts/pie/ 301\n");
  const site = await createSite({ root, adminUrl: "https://editor.example/admin/" });
  const server = createService({ handlers: {}, site });
  const base = await listen(server);
  const get = (path, init) => fetch(`${base}${path}`, { redirect: "manual", ...init });
  try {
    assert.equal(await (await get("/")).text(), "<h1>home</h1>");
    assert.equal(await (await get("/posts/pie/")).text(), "<h1>pie</h1>");
    const folder = await get("/posts/pie");
    assert.equal(folder.status, 301);
    assert.equal(folder.headers.get("location"), "/posts/pie/");
    const old = await get("/old-pie/");
    assert.equal(old.status, 301);
    assert.equal(old.headers.get("location"), "/posts/pie/");
    const admin = await get("/admin");
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get("location"), "https://editor.example/admin/");
    const feed = await get("/rss.xml");
    assert.equal(feed.headers.get("access-control-allow-origin"), "*");
    assert.match(feed.headers.get("content-type"), /xml/);
    const latest = await get("/api/blog.json");
    assert.equal(latest.status, 200, "a file the build wrote under /api/ is served");
    assert.equal(latest.headers.get("access-control-allow-origin"), "*");
    assert.equal((await get("/api/comments")).status, 404, "any other /api/ path is the functions'");
    assert.equal((await get("/")).headers.get("access-control-allow-origin"), null);
    const missing = await get("/nope/");
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "<h1>missing</h1>");
    assert.equal((await get("/..%2f..%2fetc%2fpasswd")).status, 404);
    assert.equal((await get("/_redirects")).status, 404);
    const first = await get("/");
    const again = await get("/", { headers: { "if-none-match": first.headers.get("etag") } });
    assert.equal(again.status, 304);
    assert.equal((await get("/", { method: "POST" })).status, 405);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

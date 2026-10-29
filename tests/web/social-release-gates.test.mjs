// Release gates for optional social publishing (story #360, ADR 0332): the setup and rollback guide,
// the settings the code reads, the SQL files and the provider API versions agree, so the guide a
// self-hosting owner follows cannot drift from what ships. Static checks always run. The rollback
// check also runs the real SQL when OPENBLOG_TEST_PG_URL names an empty scratch database (see
// social-queue-sql.test.mjs); it is skipped otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS, VERSION_SUPPORT, socialProviders } from "../../netlify/lib/social-providers.mjs";
import { deliveryPolicy } from "../../netlify/lib/social-delivery.mjs";
import { opsPolicy } from "../../netlify/lib/social-ops.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const guide = read("docs/social-publishing.md");
const strip = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();

const section = (heading) => {
  const start = guide.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `the guide has a "${heading}" section`);
  const end = guide.indexOf("\n## ", start + 4);
  return guide.slice(start, end < 0 ? undefined : end);
};

const hosted = [
  ...readdirSync(join(ROOT, "netlify/lib")).filter((name) => /^social-.*\.mjs$/.test(name)).map((name) => `netlify/lib/${name}`),
  ...readdirSync(join(ROOT, "netlify/functions")).filter((name) => /^social.*\.mjs$/.test(name)).map((name) => `netlify/functions/${name}`),
];
const adminSide = ["crates/openblog-cli/src/admin/social.rs", "crates/openblog-cli/src/admin/announcements.rs"];

test("every setting the social code reads is documented in the guide", () => {
  const names = new Set();
  for (const path of [...hosted, ...adminSide]) {
    for (const match of read(path).matchAll(/\b((?:OPENBLOG|SUPABASE)_[A-Z0-9_]*[A-Z0-9])\b/g)) names.add(match[1]);
  }
  // The per-provider settings are built from a template in social-providers.mjs.
  for (const provider of PROVIDERS) {
    for (const suffix of ["CLIENT_ID", "CLIENT_SECRET", "API_VERSION", "SCOPES", "PKCE"]) names.add(`OPENBLOG_SOCIAL_${provider.toUpperCase()}_${suffix}`);
  }
  names.delete("OPENBLOG_SOCIAL");
  assert.ok(names.size >= 25, `found ${names.size} settings`);
  for (const name of names) {
    const templated = name.replace(/^OPENBLOG_SOCIAL_(LINKEDIN|FACEBOOK)_/, "OPENBLOG_SOCIAL_<PROVIDER>_");
    assert.ok(guide.includes(`\`${name}\``) || guide.includes(`\`${templated}\``), `${name} is not in docs/social-publishing.md`);
  }
});

// The accepted range of a bounded setting, found by asking the code, not by copying it.
function range(accepts, name) {
  const ok = (value) => accepts(name, String(value));
  let low = 0;
  while (!ok(low) && low < 10000) low += 1;
  let high = low;
  while (ok(high + 1) && high < 10000) high += 1;
  return [low, high];
}

test("the bounded settings the guide lists have the ranges the code enforces", () => {
  // The budget must also leave room for the provider timeout, so it is probed with the shortest one.
  const delivery = (name, value) => !deliveryPolicy({ OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS: name.endsWith("BUDGET_SECONDS") ? "2" : "", [name]: value }).problems.includes(name);
  const ops = (name, value) => !opsPolicy({ OPENBLOG_SOCIAL_OPS: "true", [name]: value }).problems.includes(name);
  const bounded = [
    ["OPENBLOG_SOCIAL_BATCH_SIZE", delivery],
    ["OPENBLOG_SOCIAL_LEASE_SECONDS", delivery],
    ["OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS", delivery],
    ["OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS", delivery],
    ["OPENBLOG_SOCIAL_MAX_ATTEMPTS", delivery],
    ["OPENBLOG_SOCIAL_BACKOFF_SECONDS", delivery],
    ["OPENBLOG_SOCIAL_RETENTION_DAYS", ops],
    ["OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES", ops],
  ];
  for (const [name, accepts] of bounded) {
    const [low, high] = range(accepts, name);
    assert.ok(high >= low && low > 0, `${name} has a range`);
    const lines = guide.split("\n").filter((line) => line.includes(`\`${name}\``));
    assert.ok(lines.some((line) => line.includes(`${low} to ${high}`)), `the guide gives ${name} as ${low} to ${high}`);
  }
});

const setupFiles = readdirSync(join(ROOT, "supabase")).filter((name) => /^social(-[a-z]+)?\.sql$/.test(name) && !name.endsWith("-rollback.sql"));

test("every social SQL file has a rollback, and the guide names both", () => {
  assert.deepEqual([...setupFiles].sort(), ["social-cron.sql", "social-history.sql", "social-ops.sql", "social-queue.sql", "social.sql"]);
  for (const file of setupFiles) {
    const undo = file.replace(/\.sql$/, "-rollback.sql");
    assert.ok(existsSync(join(ROOT, "supabase", undo)), `${undo} exists`);
    assert.ok(guide.includes(`supabase/${file}`) || guide.includes(`\`${file}\``), `the guide names ${file}`);
    assert.ok(guide.includes(`supabase/${undo}`) || guide.includes(`\`${undo}\``), `the guide names ${undo}`);
  }
});

test("the rollout lists the SQL files in the order they depend on each other, and the rollback reverses it", () => {
  const rollout = section("Rolling it out, step by step");
  const order = ["social.sql", "social-queue.sql", "social-history.sql", "social-cron.sql", "social-ops.sql"];
  const at = order.map((file) => rollout.indexOf(`supabase/${file}`));
  for (const [i, file] of order.entries()) assert.ok(at[i] >= 0, `the rollout names supabase/${file}`);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], `${order[i - 1]} comes before ${order[i]}`);
  for (const file of ["social-queue.sql", "social-history.sql", "social-ops.sql", "social-cron.sql"]) {
    const text = read(`supabase/${file}`).replace(/\r?\n--\s*/g, " ").replace(/\s+/g, " ");
    assert.match(text, /after social\.sql/i, `${file} says it runs after social.sql`);
  }

  const rollback = section("Rolling it back");
  const steps = ["OPENBLOG_SOCIAL_ENABLED", "OPENBLOG_SOCIAL_ENDPOINT", "supabase/social-rollback.sql", "vault.secrets", "OPENBLOG_SOCIAL_TOKEN_KEYS"];
  const where = steps.map((step) => rollback.indexOf(step));
  for (const [i, step] of steps.entries()) assert.ok(where[i] >= 0, `the rollback mentions ${step}`);
  for (let i = 1; i < where.length; i += 1) assert.ok(where[i - 1] < where[i], `${steps[i - 1]} comes before ${steps[i]}`);
});

test("the guide says how to rotate every secret", () => {
  const rotate = section("Rotating secrets");
  for (const name of ["OPENBLOG_SOCIAL_ADMIN_KEY", "OPENBLOG_SOCIAL_WORKER_KEY", "SUPABASE_SECRET_KEY", "OPENBLOG_SOCIAL_TOKEN_KEYS", "OPENBLOG_SOCIAL_<PROVIDER>_CLIENT_SECRET", "openblog_social_worker_key"]) {
    assert.ok(rotate.includes(name), `the rotation section covers ${name}`);
  }
  assert.match(rotate, /vault\.update_secret/);
});

test("the rate limit and troubleshooting sections cite the providers and name the real codes", () => {
  const limits = section("Rate limits");
  assert.match(limits, /learn\.microsoft\.com\/en-us\/linkedin\/shared\/api-guide\/concepts\/rate-limits/);
  assert.match(limits, /developers\.facebook\.com\/docs\/graph-api\/overview\/rate-limiting/);
  assert.match(limits, /80001/);
  const trouble = section("Troubleshooting");
  for (const code of ["backlog-overdue", "provider-not-configured", "needs-review", "accounts-need-reconnect"]) assert.ok(trouble.includes(code), code);
  assert.match(trouble, /cron\.job_run_details/);
  assert.match(trouble, /net\._http_response/);
});

test("the full rollback stops the cron job before the tables go and drops only social objects", () => {
  const undo = strip(read("supabase/social-rollback.sql"));
  const unschedule = undo.indexOf("cron.unschedule(jobid) from cron.job where jobname = 'openblog-social-worker'");
  assert.ok(unschedule >= 0, "the full rollback unschedules the worker job");
  assert.match(undo, /if to_regclass\('cron\.job'\) is not null then/, "a database without pg_cron can still roll back");
  assert.ok(unschedule < undo.indexOf("drop table"), "the job stops before any table is dropped");
  assert.match(undo, /drop function if exists public\.openblog_social_worker_ping\(\)/);
  for (const file of readdirSync(join(ROOT, "supabase")).filter((name) => /^social.*-rollback\.sql$/.test(name))) {
    const text = strip(read(`supabase/${file}`));
    for (const match of text.matchAll(/drop (table|function|trigger|index|view) if exists (?:public\.)?(\w+)/g)) {
      assert.match(match[2], /^openblog_social_/, `${file} drops ${match[2]}`);
    }
    assert.doesNotMatch(text, /drop extension|drop schema|\btruncate\b/, `${file} drops nothing shared`);
  }
});

test("each default provider API version is still served, as its provider documented it", () => {
  const today = new Date().toISOString().slice(0, 10);
  const configured = socialProviders({
    OPENBLOG_SOCIAL_CALLBACK_BASE: "https://blog.example.com/api/social",
    OPENBLOG_SOCIAL_LINKEDIN_CLIENT_ID: "client",
    OPENBLOG_SOCIAL_LINKEDIN_CLIENT_SECRET: "secret-value",
    OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID: "client",
    OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET: "secret-value",
  });
  for (const provider of PROVIDERS) {
    const support = VERSION_SUPPORT[provider];
    assert.ok(support, `${provider} has a recorded support window`);
    assert.equal(configured[provider].version, support.version, `${provider}: the recorded version is the default`);
    assert.match(support.source, /^https:\/\/(learn\.microsoft\.com|developers\.facebook\.com)\//);
    assert.ok(support.checkedOn <= today, `${provider}: checked on a past date`);
    // If this fails, the provider has retired the default: check its documentation, move the default
    // to a current version, update VERSION_SUPPORT and the fixtures, and say so in the changelog.
    assert.ok(today < support.supportedUntil, `${provider}: default ${support.version} was served only until ${support.supportedUntil}`);
    assert.ok(guide.includes(support.supportedUntil), `the guide gives ${provider}'s end date`);
  }
});

test("every ADR the social code, SQL, settings and guide name exists", () => {
  const adrs = new Set(readdirSync(join(ROOT, "docs/adr")).map((name) => name.slice(0, 4)));
  const sources = [...hosted, ...adminSide, "netlify.toml", "docs/social-publishing.md", "web/admin/social.js", "web/admin/announcements.js", ...readdirSync(join(ROOT, "supabase")).filter((name) => name.startsWith("social")).map((name) => `supabase/${name}`)];
  for (const path of sources) {
    for (const match of read(path).matchAll(/ADRs?\s+(\d{4}(?:(?:\s*,\s*|\s+and\s+|\s+to\s+|-)\d{4})*)/g)) {
      for (const number of match[1].match(/\d{4}/g)) assert.ok(adrs.has(number), `${path} names ADR ${number}, which does not exist`);
    }
  }
});

// ---- The full rollback, against a real Postgres, when one is supplied. ----

const url = process.env.OPENBLOG_TEST_PG_URL;
const live = url ? test : test.skip;
const psql = (args, input) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], { input, encoding: "utf8" }).trim();
const sql = (text) => psql([], text);
const path = (name) => join(ROOT, "supabase", name);

live("against a real Postgres: the full rollback stops the worker job, leaves other jobs, and removes every social object", () => {
  if (sql("select to_regclass('cron.job') is not null") === "t") return; // A real pg_cron: not ours to stub.
  sql(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;`);
  // A stand-in for pg_cron's catalogue and unschedule, and for the ping function social-cron.sql makes.
  sql(`create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text);
    create function cron.unschedule(p_job bigint) returns boolean language sql as $f$ delete from cron.job where jobid = p_job returning true $f$;
    insert into cron.job (jobname) values ('openblog-social-worker'), ('someone-elses-job');
    create function public.openblog_social_worker_ping() returns bigint language sql as $f$ select null::bigint $f$;`);
  try {
    psql(["-f", path("social.sql")]);
    psql(["-f", path("social-queue.sql")]);
    psql(["-f", path("social-history.sql")]);
    psql(["-f", path("social-ops.sql")]);
    psql(["-f", path("social-rollback.sql")]);
    assert.equal(sql("select string_agg(jobname, ',' order by jobname) from cron.job"), "someone-elses-job");
    assert.equal(sql("select count(*) from pg_proc where proname like 'openblog_social%'"), "0");
    assert.equal(sql("select count(*) from pg_tables where tablename like 'openblog_social%'"), "0");
    psql(["-f", path("social-rollback.sql")]);
  } finally {
    sql("drop schema if exists cron cascade; drop function if exists public.openblog_social_worker_ping();");
    psql(["-f", path("social-rollback.sql")]);
  }
});

# Netlify hosted engagement

This function provides moderated comments and persistent analytics for a static open.blog site.
Supabase is accessed only from the function; never put its secret key in `openblog.json` or a
browser script.

## Setup

1. Create a Supabase project and run [`supabase/openblog.sql`](../../supabase/openblog.sql) in its
   SQL editor.
2. In Netlify, open **Site configuration → Environment variables** and set:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project URL from Supabase API settings |
   | `SUPABASE_SECRET_KEY` | Supabase secret API key (`sb_secret_...`); server-only |
   | `OPENBLOG_SITE_ID` | Stable identifier such as `lantern-studios` |
   | `OPENBLOG_SITE_ORIGIN` | Exact public origin, such as `https://blog.example.com` |
   | `OPENBLOG_ADMIN_API_KEY` | Long random token used for moderation and Admin analytics |
   | `OPENBLOG_ANALYTICS_SALT` | Separate long random value used only to hash daily visitors |
   | `OPENBLOG_SITE_BASE_PATH` | Optional public base path such as `/blog/`; defaults to `/` |

   Find the secret key under **Supabase project settings → API Keys → Publishable and secret API keys**.
   Neither `SUPABASE_PUBLISHABLE_KEY` nor `SUPABASE_JWKS_URL` is needed by this integration.
   Secret keys are sent in the `apikey` header, not as bearer JWTs. Existing deployments may keep
   `SUPABASE_SERVICE_ROLE_KEY` as a fallback; `SUPABASE_SECRET_KEY` takes precedence when both are
   set. Legacy JWT keys retain their bearer authentication. No SQL migration is required: both
   server key types use the database's `service_role` permissions.

3. Deploy (or redeploy after changing environment variables). `netlify.toml` maps the public and Admin API routes to the function.
4. Run `openblog serve --admin`, open **Analytics**, enable hosted engagement, and set the endpoint
   to `https://your-site.example/api`. Enter the same value as `OPENBLOG_ADMIN_API_KEY` in the
   write-only moderation token field. The Admin copy stays in `.openblog/private` and is never
   committed or returned after saving. If you instead set `OPENBLOG_ENGAGEMENT_API_KEY` on the
   machine running Admin, also set `OPENBLOG_ENGAGEMENT_API_ORIGIN` to the exact endpoint origin;
   this binding prevents the token from being sent to a changed destination.

New comments remain pending until approved in **Admin → Analytics → Comment moderation**. For every
public comment read or submission, the function fetches the generated `openblog-comments.json`
manifest from `OPENBLOG_SITE_ORIGIN` and enforces its open, locked, or hidden policy before querying Supabase.
Keep that origin current and publicly reachable. Public pages never receive any Supabase key or the
moderation token. Supabase-backed hourly quotas limit comment submissions and analytics writes
before content is stored.

## Passage feedback (optional)

The same function can accept typed passage feedback: a reader's question, suggested source,
suggested correction or other interpretation of a passage, with the passage target and the
revision of the page they saw (ADRs 0087 to 0089). It is off by default. A site that does not opt
in needs no extra table, publishes nothing new and behaves exactly as before.

To opt in:

1. Run [`supabase/feedback.sql`](../../supabase/feedback.sql) in the Supabase SQL editor, after
   `openblog.sql`. It only adds two private tables, `openblog_feedback` and its moderation audit
   trail `openblog_feedback_events`, and the moderation function `openblog_moderate_feedback`; it
   changes no existing table, column, function or row, and running it twice is harmless.
2. In Netlify, set `OPENBLOG_FEEDBACK_ENABLED` to `true` and redeploy. Any other value, or no
   value, keeps the feature off, and the feedback routes then answer `404` with a short explanation
   without touching Supabase.
3. In `openblog.json`, set `"feedback": true` inside `engagement` (hosted engagement must be
   enabled with an endpoint). The build then publishes `openblog-feedback.json`, which gives each
   post's feedback policy from its `comments:` setting (`open`, `locked` or `hidden`). The function
   reads it from `OPENBLOG_SITE_ORIGIN` and accepts feedback only for posts marked `open`. Each
   open post also gets a "Questions and corrections" form (ADR 0094). Optionally set
   `"feedbackContact"` inside `engagement` to a `mailto:` address or an `https:` contact page, which
   the form offers when a note cannot be sent.

The routes are `POST /api/feedback` (public, same-origin only) and `GET`/`PATCH
/api/admin/feedback` (moderation, `Authorization: Bearer` with `OPENBLOG_ADMIN_API_KEY`). Every
submission is checked with the same rules as the build, stored `pending` with the time the
function received it, and limited by the existing hourly quota (5 per client, 500 per site). A
reader's name is stored apart from comments and is never public unless they agreed. No e-mail is
collected and nothing is sent to readers. When the endpoint is missing, off or failing, the page is
unchanged and readers can copy their note to the author instead.

### Moderation

Moderate in **Admin → Reader feedback** (ADR 0095). Admin calls `GET /api/admin/feedback` and
`PATCH /api/admin/feedback` itself, with the saved moderation token, so the token never reaches
the browser. A change is `{id, action, from, expectedVersion, reason?, actor?}`: `approve`
(pending only), `reject` (pending or clarification, with a reason) or `remove` (approved, with a
reason), where `reason` is one of `spam`, `abusive`, `personal-data`, `off-topic`, `duplicate`,
`rights` or `other`. The function `openblog_moderate_feedback` applies it only while the item still
has the state and version the moderator saw, raises the version and records who did what, when
and why in `openblog_feedback_events`, in one statement; otherwise the route answers `409` with
the item as it is now. Approved notes are copied, without anything private, to
`content/reader-feedback.json` in the site's repository, which the build publishes; the function
never serves them to readers.

### Rolling back

1. Remove `OPENBLOG_FEEDBACK_ENABLED` in Netlify (or set it to anything but `true`) and redeploy.
   Feedback routes stop at once; comments and analytics are unaffected.
2. Optionally set `"feedback": false` in `openblog.json` and rebuild, which stops publishing
   `openblog-feedback.json` and removes the forms from posts.
3. To remove the stored feedback too, export it if you want to keep it, then run
   [`supabase/feedback-rollback.sql`](../../supabase/feedback-rollback.sql). It drops only the
   moderation function, `openblog_feedback_events` and `openblog_feedback`. Without this step the
   tables simply stay unused.

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

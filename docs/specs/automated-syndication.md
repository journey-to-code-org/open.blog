# Automated syndication

Status: implemented first stable iteration  
Date: 2026-10-24

## Outcome

An owner can plan or perform a cross-post of one open.blog post while keeping open.blog as
the source of truth. The command creates drafts by default, uses saved remote IDs for later
updates, and never treats a missing local post as permission to delete remote content.

## CLI contract

```text
openblog syndicate <slug> [--target name[,name...]] [--write] [--publish]
```

- With no `--write`, the command prints a plan and neither reads credentials nor contacts a
  provider nor changes private state.
- `--target` selects configured target names. Without it, every enabled target is planned.
- `--write` creates a remote draft or updates the remote ID saved for that source and target.
- Remote content remains a draft unless `--publish` is supplied **and** that target has
  `allowPublish: true`. This is a deliberate two-step opt-in.
- Hashnode remains draft-only in this iteration because publishing a draft is a distinct
  second mutation. The command reports this instead of silently making a second write.
- Medium produces guided manual-import instructions. It never claims that Medium offers a
  supported API for new integrations.

## Configuration contract

`openblog.json` accepts a provider-neutral map of user-named targets:

```json
{
  "syndication": {
    "stateFile": ".openblog/syndication.json",
    "targets": {
      "community": { "provider": "dev", "enabled": true, "allowPublish": false },
      "publication": { "provider": "hashnode", "publicationId": "PUBLICATION_ID" },
      "ghost": { "provider": "ghost", "endpoint": "https://example.ghost.io" },
      "wordpress-com": { "provider": "wordpress", "publicationId": "12345678" },
      "wordpress-self-hosted": {
        "provider": "wordpress",
        "endpoint": "https://wordpress.example/wp-json/wp/v2"
      },
      "medium": { "provider": "medium" }
    }
  }
}
```

Target names are stable user-facing identities and permit multiple destinations using the
same provider. Supported provider values are `dev`, `hashnode`, `ghost`, `wordpress`, and
`medium`. Missing target fields receive conservative defaults: enabled, draft-only, and no
endpoint or publication ID. No credential belongs in configuration.

| Target | Environment variable(s) |
| --- | --- |
| DEV | `DEVTO_API_KEY` |
| Hashnode | `HASHNODE_PAT` |
| Ghost | `GHOST_ADMIN_API_KEY` (`id:hex-secret`) |
| WordPress.com | `WORDPRESS_ACCESS_TOKEN` |
| Self-hosted WordPress | `WORDPRESS_USERNAME`, `WORDPRESS_APPLICATION_PASSWORD` |
| Medium | None; manual import |

## Source and state contract

The stable source identity is the optional `syndicationId` front-matter field. When absent,
the normalized source path is used and must not be renamed after a remote copy is created.
New long-lived automations should set an immutable ID:

```yaml
syndicationId: 01JAZ8M7Y64Q9Z8P6ACZHQN5KC
```

Private state defaults to `.openblog/syndication.json`. Records are keyed by source identity
plus configured target name and contain source path, remote ID, remote URL when supplied,
provider concurrency revision when required, source revision, remote publication state, and
update time. A source-ID collision with a
different source path fails closed. State is saved after each successful target, so partial
success is retained without attempting a remote rollback.

The state path must be project-relative and cannot contain `..`. Keep `.openblog/` out of
public output and commit history.

## Provider behavior

| Provider | Create | Update | Body | Canonical behavior |
| --- | --- | --- | --- | --- |
| DEV | `POST /api/articles` | `PUT /api/articles/{id}` | Markdown | Sends open.blog URL |
| Hashnode | `createDraft` | `updateDraft` by saved ID | Markdown | Sends open.blog URL; Pro required |
| Ghost | Admin API create | Admin API update by ID | Rendered HTML | Sends `canonical_url` |
| WordPress.com | WP v2 create | WP v2 update by ID | Rendered HTML | Core cannot set external canonical |
| Self-hosted WordPress | Core WP v2 create | Core WP v2 update by ID | Rendered HTML | Core cannot set external canonical |
| Medium | No API call | No API call | Official import flow | Medium adds source canonical |

Relative root links and images are made absolute before transmission. DEV receives at most
four tags and Hashnode receives at most fifteen.

## Safety acceptance criteria

- [x] Dry-run is the default and performs no provider request.
- [x] Writes require explicit `--write`.
- [x] Public writes require both `--publish` and per-target `allowPublish: true`.
- [x] Canonicals derive from the configured open.blog URL and final post route.
- [x] Canonicals must be public HTTPS and cannot use the scaffold `example.com` host.
- [x] Secrets are environment-only and are not serialized into config, state, output, or logs.
- [x] Provider endpoints are fixed except for user-owned Ghost and WordPress origins, which
  must be HTTPS without embedded credentials, query, or fragment.
- [x] Responses are limited to 1 MiB and requests have a 30-second global deadline.
- [x] Auth, plan/permission, validation, conflict, rate-limit, and outage statuses produce
  actionable errors.
- [x] Creates persist remote IDs and later runs update those IDs.
- [x] State is saved per successful destination; partial success is not rolled back.
- [x] No remote deletion operation exists.
- [x] Request builders and parsing are tested through a transport seam without live calls.

## Out of scope

- Probing the deployed canonical over the public internet; deployment remains a prerequisite.
- Automatic Medium publishing or legacy Medium tokens.
- Portable WordPress external-canonical support; plugin support needs an explicit extension.
- Automatic Hashnode `publishDraft`, reconciliation by title, bulk runs, retry loops,
  scheduling, remote deletion, media upload, or live provider tests.
- Browser/Admin credential setup. This iteration targets a trusted shell or protected CI.


# ADR 0383: The owner is told by one opt-in email to their own address that carries no contact details and can never lose a request

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#485](https://github.com/journey-to-code-org/open.blog/issues/485)
- Task: [#516](https://github.com/journey-to-code-org/open.blog/issues/516)
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Builds on: [ADR 0381](0381-quote-requests-are-stored-server-side-only-through-a-fenced-visitor-endpoint-that-is-off-by-default.md)

## Context

Telling the owner contacts a real person and passes data to a mail provider, so it is a one-way door. It must
be opt-in, reversible by turning a setting off, and conservative about what leaves the private workspace.

## Decision

- **Opt-in, off by default.** No notification unless `OPENBLOG_QUOTE_NOTIFY_PROVIDER=resend` and the key, the
  owner's address and the sender are all valid; anything missing leaves it off and names the variable, never
  the value. A request stored while it is off has `notify_status = 'off'`.
- **One fixed recipient.** The only address ever written to `to` is `OPENBLOG_QUOTE_NOTIFY_TO`, set by the
  deployer. Nothing the visitor typed becomes a recipient, a sender, a reply-to or a header; the subject takes
  only the town and service with control characters removed. No mail ever goes to a visitor.
- **Minimal content.** The email says a request arrived and gives the visitor's name, town, service, the photo
  count, a reference and where to read it (`OPENBLOG_QUOTE_ADMIN_URL` or "Admin, then Quote requests").
  Phone, email address, description and photos stay in the private workspace; they are not placed in a third
  party's mailbox, logs or retention.
- **Never loses a request.** The email is attempted after the row is stored, inside a catch-all: a failure,
  a throw or a crash only changes `notify_status`. A refused key is final; other failures get two inline tries
  and are recorded as `failed` with a fixed code (`network`, `timeout`, `rate-limited`, `provider-error`,
  `refused-key`, `rejected`) and an attempt count. A stored row left `pending` is treated as a lost attempt after
  ten minutes.
- **Bounded retries, visible failures.** With `OPENBLOG_QUOTE_ADMIN_KEY` set, `GET /api/quote/notifications`
  lists pending and failed notifications (ids, states, counts, codes, times: no visitor value) and
  `POST /api/quote/notifications/retry` retries up to 25 of them. A request is tried at most five times in all
  and then reported as given up. Admin's request screen shows the same states: the list carries each
  request's `notify` state, attempt count and fixed error code, and whether email is on at the function;
  a request whose email failed (or is still pending after ten minutes) says so in plain words, a note above
  the list counts them, and **Send those emails again** calls `POST /admin/api/quote/notifications/retry`,
  which Admin proxies to the route above and answers with counts only.
- **Idempotent.** Each send carries `Idempotency-Key: quote-<request id>`, so an ambiguous retry within the
  provider's window does not mail twice.
- **No logs.** Nothing in the notify path logs; errors are fixed codes.

## Verified provider facts

Resend `POST https://api.resend.com/emails` takes `Authorization: Bearer <key>`, required `from`, `to` and
`subject`, optional `text`, and an `Idempotency-Key` header (unique per request, expires after 24 hours, at most
256 characters) (<https://resend.com/docs/api-reference/emails/send-email>, checked 2026-10-29). Its rate limits
and error list are not on that page and were not verified; the transport maps 401 and 403, 429, 5xx and other
statuses to fixed codes without reading the body.

## Consequences

Only Resend is supported; a second provider is a new transport function. The deployer must verify the sending
domain with the provider. A failed notification is visible on its request in Admin and can be retried from there;
after five tries Admin says it will not be tried again and points to whoever set up the email.

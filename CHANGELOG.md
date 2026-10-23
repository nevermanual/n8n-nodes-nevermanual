# Changelog

All notable changes to this package are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-23

### Added

- **Never Manual API** credentials: a workspace API key (`nmk_…`) sent as a bearer token, an optional base URL,
  and a credential test against `GET /v1/me`.
- **Never Manual** node:
  - Account: Get Me.
  - Media: Upload (binary file as multipart, or by URL), Get, Get Many (kind, name, tag, added-after filters;
    cursor pagination with Return All).
  - Studio Workflow: Get, Get Many.
  - Studio Run: Start (inputs picked from the workflow's own list, or as JSON; speed; webhook URL; advanced
    settings; Wait for Completion with a timeout), Get, Get Many (status and workflow filters), Cancel.
  - Slate Account: Get Many.
  - Slate Post: Create (accounts from the list, Media IDs or links, text, queue / day / date and time, feed /
    story / carousel, hold for review), Get, Get Many (account and stage filters).
  - Idempotency-Key on every call that makes something, so Retry On Fail never starts a second run, post or file.
  - API errors shown with the API's message and code; `429 rate_limited` waited out and sent again.
- **Never Manual Trigger** node: subscribes to run.completed, run.failed, run.canceled, post.published and
  post.failed when the workflow is activated, verifies each delivery's `NM-Signature` over the raw body and
  refuses deliveries signed more than five minutes ago.

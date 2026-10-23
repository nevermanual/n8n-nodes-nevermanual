# n8n-nodes-nevermanual

n8n community nodes for [Never Manual](https://api.nevermanual.cloud/docs): run **Studio** workflows (ComfyUI
workflows on GPUs, paid from your workspace balance), keep files in the workspace's **Media**, and post them to
social accounts with **Slate** — and start a workflow when a run ends or a post goes out.

Two nodes and one credential:

| | |
|---|---|
| **Never Manual** | Studio workflows and runs, Media, Slate accounts and posts, your key and balance |
| **Never Manual Trigger** | Starts a workflow on `run.completed`, `run.failed`, `run.canceled`, `post.published`, `post.failed` |
| **Never Manual API** (credential) | Your workspace API key |

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) ·
[Trigger](#trigger) · [Example workflow](#example-workflow) · [Good to know](#good-to-know) ·
[Compatibility](#compatibility) · [Development](#development) · [Version history](#version-history)

## Installation

### Self-hosted n8n

1. Open **Settings → Community Nodes**.
2. Click **Install**, enter `n8n-nodes-nevermanual`, tick the box that you understand the risks of community
   nodes, and click **Install**.
3. Search for **Never Manual** in the nodes panel.

If your n8n runs in queue mode or you manage packages yourself, install the package into n8n's custom folder
instead and restart n8n:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-nevermanual
```

See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
for details.

### n8n Cloud

The package is being submitted for n8n's verification; once verified it appears in the nodes panel of n8n Cloud.

## Credentials

1. Sign in to Never Manual and open **Accounts → API keys** (you need to be a workspace admin).
2. Click **New key**, name it after what will use it (for example `n8n`), and choose:
   - **Full access** to start runs, add files, post and use the trigger (it subscribes webhooks);
   - **Read only** to list and read only.
3. Copy the key (`nmk_…`). It is shown once.
4. In n8n, create a **Never Manual API** credential and paste the key into **API Key**. Leave **Base URL** as
   `https://api.nevermanual.cloud` unless Never Manual gave you another address.

n8n checks the credential by calling `GET /v1/me`. The key is sent as `Authorization: Bearer nmk_…`.
Paid work (Studio runs) is charged to the key's workspace at the same prices as in the apps; an empty balance
answers `402 insufficient_balance`.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| **Account** | Get Me | The key, its workspace and the workspace's balance (`GET /v1/me`) |
| **Media** | Upload | Adds a file to Media: a **binary file** from the input item (multipart, up to 100 MB) or a **URL** it is fetched from (up to 2 GB; Google Drive and Dropbox share links work). Optional name and tags. |
| | Get | One file with fresh links (links work for about two hours) |
| | Get Many | Files, newest first; filters: kind (image/video), name contains, tag, added after; Return All or a limit |
| **Studio Workflow** | Get | A workflow and the inputs a run takes |
| | Get Many | What Studio can run: Studio's workflows and your workspace's own |
| **Studio Run** | Start | Starts a run of the chosen workflow. **Inputs** are picked from the workflow's own list (or given as JSON); a file input takes a Media ID or an http(s) link. **Speed**: Cheaper, Standard or Faster. **Wait for Completion** (on by default) reads the run every few seconds until it ends and outputs the finished run with its files and download links; **Timeout** defaults to 15 minutes. Optional **Webhook URL** and **Advanced Settings (JSON)**. |
| | Get | A run: its status and, once completed, its files |
| | Get Many | Runs, newest first; filters: status, workflow |
| | Cancel | Stops a run that has not ended |
| **Slate Account** | Get Many | Social accounts: platform, handle, and how Slate posts to each (API, phone or by hand) |
| **Slate Post** | Create | Posts Media files to the chosen accounts: each file becomes a post on each account (**Carousel**: all files one post; **Story**: stories). **Text** empty = each account writes its own in its voice. **When**: next free slot, a day, or a date and time (in the workspace's time zone). **Hold for Review** (on by default) keeps the posts waiting in Slate's queue until a person releases them. Outputs one item per post. |
| | Get | A post: its stage, and its link once published |
| | Get Many | Posts, newest first; filters: account, stage |

The **Never Manual** node can also be used as a tool by n8n's AI Agent.

## Trigger

Add **Never Manual Trigger**, pick the events, and activate the workflow. On activation the node subscribes its
webhook address (`POST /v1/webhooks`) and keeps the subscription's secret; on deactivation it unsubscribes.

| Event | When |
|---|---|
| Run Completed (`run.completed`) | A Studio run ended with its files (with download links) |
| Run Failed (`run.failed`) | A Studio run failed; `data.error` says why |
| Run Canceled (`run.canceled`) | A Studio run was stopped |
| Post Published (`post.published`) | A Slate post went out; `data.url` is its link |
| Post Failed (`post.failed`) | A Slate post failed; `data.error` says why |

Each delivery is checked before the workflow starts: the `NM-Signature` header
(`t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`) must match the raw body and be at most five
minutes old; anything else is answered `401` and does not start the workflow. The item is the event itself:

```json
{
  "id": "evt_…",
  "type": "run.completed",
  "created_at": "2026-10-23T13:41:43.892Z",
  "data": { "id": "job_…", "status": "completed", "outputs": [{ "media_id": 101, "media": { "urls": { "download": "https://…" } } }] }
}
```

Never Manual tries a delivery again after 1 min, 5 min, 30 min, 2 h, 6 h and 24 h until n8n answers `2xx`, so
the same event can arrive twice; its `id` stays the same.

## Example workflow

**A new file in Google Drive → Media → a Studio run → posts in Slate:**

1. **Google Drive Trigger** — *On changes involving a specific folder*, event *File Created*. Share the folder
   (or the files) as *Anyone with the link* so Never Manual can fetch them.
2. **Never Manual** — *Media → Upload*, Source **URL**, URL `{{ $json.webViewLink }}`, Tags `drive`.
   (For private files, put a **Google Drive → Download** node first and use Source **Binary File** instead.)
3. **Never Manual** — *Studio Run → Start*, pick the workflow, add an input (for example *Photo*) with the value
   `{{ $json.id }}` (the Media ID from the previous step), keep **Wait for Completion** on.
4. **Never Manual** — *Slate Post → Create*, pick the accounts, Media IDs or Links
   `{{ $json.outputs.map(o => o.media_id).join(',') }}`, When *Next Free Slot*, keep **Hold for Review** on until
   you trust the flow.

To hear when the posts go out, build a second workflow that starts with **Never Manual Trigger** on
*Post Published* and *Post Failed*.

## Good to know

- **No double runs on retries.** Start (Studio Run), Upload (Media) and Create (Slate Post) send an
  `Idempotency-Key` made from the execution, the node, the item and the request, so n8n's *Retry On Fail* gets
  the run, file or posts it already made. A new execution always makes new ones.
- **Waiting and timeouts.** When a run takes longer than the timeout, the node fails and the run keeps going in
  Studio: read it later with *Studio Run → Get*, or raise the timeout. A run that ends *failed* or *canceled*
  fails the node with the reason; turn on *Continue On Fail* (Settings → On Error) to branch on it instead.
- **Errors.** The API's message is the node's error message; the API's code (`invalid_input`,
  `insufficient_balance`, `forbidden`, `not_found`, `rate_limited`…) and any details are in the description.
  With *Continue On Fail* the item carries `error`, `code` and `httpCode`.
- **Rate limits.** A `429` is waited out (up to a minute, three times) and sent again. A key may make a limited
  number of runs, posts and files a minute — a loop gone wrong costs a `429`, not a hundred GPU runs.
- **Links expire.** Download links in Media and runs work for about two hours; read the file again
  (*Media → Get*) for fresh ones.
- **Videos are processed after upload.** A video is `processing` for a while after it lands in Media; runs and
  posts accept it right away.

## Compatibility

Built with n8n's node CLI (`@n8n/node-cli` 0.53) against `n8n-workflow` 2.x, with no runtime dependencies.
Works with self-hosted n8n that supports community nodes; please
[open an issue](https://github.com/nevermanual/n8n-nodes-nevermanual/issues) if something does not work on your
version.

## Development

```bash
npm install
npm run dev     # starts n8n at http://localhost:5678 with these nodes, rebuilding on changes
npm run build   # compiles to dist/
npm run lint    # n8n's community node lint (strict, n8n Cloud rules)
```

Releases are published from GitHub Actions with npm provenance (`.github/workflows/publish.yml`): bump the
version in `package.json`, add it to `CHANGELOG.md`, commit, then push a `v<version>` tag or publish a GitHub
release for it. A publish from a laptop is refused by `prepublishOnly`.

## Resources

- [Never Manual API reference](https://api.nevermanual.cloud/docs) and its
  [OpenAPI document](https://api.nevermanual.cloud/v1/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)

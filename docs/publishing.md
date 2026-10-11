# Publishing pages

Agents publish through the MCP tools below. You don't call them yourself: ask the agent in plain words and it picks the right one.

## What makes a good page

- **One HTML document, or a small site.** A single self-contained document (inline CSS and JavaScript) is simplest. When a page is easier to build from several files, the agent sends the HTML as the entry plus its CSS, JavaScript, images, fonts and data, referenced by relative paths like `css/site.css` or `img/logo.png`. Scripts and fonts from public CDNs load fine either way.
- **Small.** The HTML can be up to 2 MB, each other file up to 5 MB, and all of it together up to 10 MB, with at most 100 files besides the HTML. Compress images, or load large media from a URL.
- **On the hosted service's free Personal plan**, a personal workspace holds up to 50 pages and 1 GB of storage. New versions of a page don't count toward the 50, so when you reach it, update a page you have or delete one you no longer need. Pages in an organization don't count either. See [Limits](#limits).
- **A short title.** It shows in the gallery and the browser tab (up to 200 characters).

Pages run in a sandboxed frame: scripts, forms, pop-ups and downloads work, but a page can't read cookies, use `localStorage` on the app's origin, or talk to the rest of The Artifact. Its own files load normally, including with `fetch()`.

The gallery shows a screenshot of each page, taken on the server a few seconds after it is published (see [Security](/docs/security) for how). Until it exists, a card shows a sketch. Pages shared with **Anyone with the link** also use it in [link previews](/docs/sharing#link-previews).

## Tools

Tools that take an `artifact_id` act on pages in the agent's own workspace with your permissions there, and on pages anywhere else only as far as they are shared with you directly or by link (see [Choosing a workspace](/docs/connect-your-agent#choosing-a-workspace)). `POST /api/publish` follows the same rule.

### publish_artifact

Publishes a page and returns its link, as text and as structured content (`{ id, url, title, version, visibility, folder }`, the same as [`publish_upload`](#prepare_upload-and-publish_upload) answers). In an agent that supports MCP Apps, the page itself shows under the call (see [Pages in the chat](#pages-in-the-chat)).

| Argument | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Title for the gallery and tab |
| `html` | yes | The complete HTML document. For a multi-file page, the entry (`index.html`). |
| `files` | no | Other files of the page: a list of `{ path, content, encoding }` (see below) |
| `artifact_id` | no | Id or link of an existing page. Publishes a new version at the same link. |
| `visibility` | no | `private` (shown as **Restricted**), `organization` or `link` (see [Sharing](/docs/sharing)) |
| `folder` | no | Name of a [folder](#folders) in the connected workspace, up to 80 characters. It is created if there is none by that name. An empty string takes the page out of its folder. Left out, a new page goes in no folder and an existing one stays where it is. |

Each file in `files` has:

| Field | Meaning |
| --- | --- |
| `path` | Where the HTML finds it, relative to the page: `app.js`, `css/site.css`, `img/logo.png`. Letters, digits and `. _ - @ +`, separated by `/`, up to 200 characters. No leading `/`, no `.` or `..` parts, no hidden files. `index.html` is taken by `html`. |
| `content` | The file itself: text as is, binary files in base64 |
| `encoding` | `utf8` (the default) or `base64`. Images, fonts, audio, video and WebAssembly must be `base64`. |

Allowed types, by extension: `html`, `htm`, `css`, `js`, `mjs`, `json`, `map`, `txt`, `md`, `csv`, `xml`, `svg`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `ico`, `woff`, `woff2`, `ttf`, `otf`, `mp3`, `wav`, `ogg`, `mp4`, `webm`, `wasm`. Each is served with its own content type, never guessed from the content.

A version is always a complete set: when the agent publishes a new version with `publish_artifact`, it sends every file again. Files it leaves out are not carried over (older versions keep theirs). To change only some files and keep the rest, the agent uses [`update_files`](#update_files).

Invalid files are rejected with a message the agent can act on, and nothing is published.

New pages are restricted in a personal workspace and visible to the organization in an organization workspace.

### update_files

Publishes a new version of a page that changes only some of its files and keeps the rest of the current version as they are. A dashboard whose data is refreshed sends only `data.json`, not the HTML, scripts and images again. For people who can edit the page.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `files` | no | Files to add or replace, as `{ path, content, encoding }` like for `publish_artifact`. A file with the path `index.html` replaces the page itself. |
| `remove` | no | Paths of files of the current version to leave out of the new one. `index.html` can't be removed. |
| `base_version` | no | The version the changes start from, which `get_artifact` tells. If someone published another version since, nothing changes and the agent is told to start again from the current one, so two agents don't overwrite each other without knowing. Left out, the changes apply to whatever version is current. |

Pass at least one file or one path to remove. The title, who can open the page and its folder stay as they are.

It is a new version like any other: it shows in the [history](/docs/version-history) with who published it and with which agent, counts toward the `publish` [rate limit](#limits) and the workspace's quota, and the page as a whole must stay within the [size limits](#what-makes-a-good-page). Removing a path the current version doesn't have, or sending and removing the same path, is refused with a message.

The files travel inside the call, as with `publish_artifact`, so `update_files` is for small changes. For large or binary files, agents that can make HTTP requests use [`prepare_upload` and `publish_upload`](#prepare_upload-and-publish_upload) with `update: true`.

### prepare_upload and publish_upload

Publish a page in two steps, with the files going straight to storage. Available when the server has `S3_PUBLIC_ENDPOINT` set (see [Configuration](/docs/configuration#object-storage)). See [Publishing by direct upload](#publishing-by-direct-upload).

`prepare_upload` takes `files`: every file of the page, **`index.html` included**, each as:

| Field | Meaning |
| --- | --- |
| `path` | `index.html` for the page itself, or the path the HTML uses for the file, with the same rules as above |
| `size` | Size in bytes |
| `sha256` | SHA-256 of the file's bytes, as 64 hex characters |

With `update: true`, `files` lists only the files to add or replace, and `index.html` only if it changes too.

It answers with an `upload_id` and a link for each file that isn't stored yet, as text and as structured content (`upload_id`, `uploads` with the `paths`, `size` and `url` of each link, and `stored`). The sizes of the files it hands out links for count toward the `upload` [rate limit](#limits), whether or not they are then published; files already stored in your own pages don't. The agent sends each file's bytes to its link with an HTTP `PUT` within 15 minutes, then calls `publish_upload`:

| Argument | Required | Meaning |
| --- | --- | --- |
| `title` | yes, unless `update` | Title for the gallery and tab |
| `upload_id` | yes | From `prepare_upload` |
| `files` | yes | The same list as for `prepare_upload` |
| `artifact_id` | no | Id or link of an existing page. Publishes a new version at the same link. |
| `visibility` | no | As for `publish_artifact` |
| `folder` | no | As for `publish_artifact` |
| `update` | no | `true` keeps the files of the current version that `files` leaves out, as [`update_files`](#update_files) does. Needs `artifact_id`. |
| `remove` | no | With `update`: paths to leave out of the new version |
| `base_version` | no | With `update`: the version the changes start from, as for `update_files` |

Its structured content is the same as the answer of [`POST /api/publish`](#publishing-without-an-agent): `{ id, url, title, version, visibility, folder }`.

### list_artifacts

Lists the pages in the connected workspace, most recently updated first, with their ids, links, folders and tags. It answers 25 at a time; when there are more, the answer ends with a `cursor` the agent passes back for the next ones. The same list also comes as structured content, for scripts: `{ pages: [{ id, title, url, version, visibility, folder, tags, updated_at }], total, cursor }`, where `total` is only counted on the first batch and `cursor` is `null` when there are no more. `query`, `folder` and `tag` combine.

| Argument | Required | Meaning |
| --- | --- | --- |
| `query` | no | Only pages whose title contains this, or whose text has these words (see [Search](#search)), ignoring case |
| `folder` | no | Only pages in the folder with this name; an empty string for pages in no folder |
| `tag` | no | Only pages with this [tag](#tags) |
| `limit` | no | How many to list, 1 to 100. 25 by default. |
| `cursor` | no | From the end of the previous answer, for the next pages |

### list_folders

Lists the folders of the connected workspace, by name, with how many of the pages you can see are in each. It takes no arguments.

### move_artifact

Files a page into a folder, or takes it out of its folder, without publishing a new version. With `workspace`, it moves the page to another workspace first, like **Move to workspace** in the app (see [Moving a page to another workspace](/docs/sharing#moving-a-page-to-another-workspace)). For people who can edit the page, from the workspace the page is in, with an agent connected to that workspace; only the owner moves a page into or out of their personal workspace. The link stays the same.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `folder` | no | Folder name, created if there is none by that name, or an empty string to take the page out of its folder. Without `workspace`, a folder of the connected workspace; with it, a folder of that workspace. Needed unless `workspace` is given. |
| `workspace` | no | `personal` for your personal workspace, or the id of an organization you are a member of. A wrong one is answered with the workspaces you can use and their ids. |

### duplicate_artifact

Makes a new page with a copy of the current version of a page you can open, like **Duplicate** in the app. The copy is yours, with its own link, and starts **Restricted**: nobody else is added, and it has no link settings, comments or views. It counts toward the `publish` [rate limit](/docs/configuration#rate-limits) and the target workspace's [quota](/docs/configuration#workspace-quotas). The copy comes back as structured content too, like `publish_artifact`.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page to copy |
| `workspace` | no | Where the copy goes: `personal` or the id of an organization you are a member of. The connected workspace by default. |
| `title` | no | Title of the copy, 1 to 200 characters. By default the page's title with " (copy)" after it. |

### tag_artifact

Adds [tags](#tags) to a page or removes them, without publishing a new version. For people who can edit the page. Tags are lowercased; tags the page already has, and ones it doesn't have to remove, are left as they are. The answer lists the page's tags.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `add` | no | Tags to add, each 1 to 32 characters without commas. A page has up to 10. |
| `remove` | no | Tags to remove; they are removed before any are added |

Pass `add`, `remove` or both.

### get_artifact

Returns the current version of a page, so the agent can edit it and publish a new version: its title, version number, tags, the list of its files with their sizes, and the entry HTML. With `path` (for example `css/site.css`) it returns that one file instead, as text or, for binary files, as base64. For anyone who can open the page.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `path` | no | A file of the page to read, e.g. `css/site.css`. Left out, or `index.html`, returns the entry HTML and the list of files. |

### inspect_artifact

Opens a page in a headless browser on the server and reports what is wrong with it, so the agent can check its work before it hands you the link. Agents are told to call it after publishing and before sharing; they fix what it finds, publish a new version and inspect again. Editors only.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `version` | no | A version number from `list_versions`. Without it, the current version. |
| `widths` | no | Widths to render at: `1280` (desktop) and `390` (a phone, with a phone's viewport handling). `[1280]` by default; `[1280, 390]` checks both. |

The answer has a screenshot per width, of the whole page down to 2,000 pixels (a PNG, or a JPEG for pages whose PNG would be over 1 MB), and a report of:

- console errors and uncaught exceptions, with the file and line
- files the page asked for that it doesn't have (answered with a 404), and requests to public CDNs that failed
- links (`<a href>`) to files of the page that don't exist
- accessibility problems found by [axe-core](https://github.com/dequelabs/axe-core) with the WCAG 2.1 A and AA rules: the rule, its impact, a short explanation and up to three elements, for at most 20 rules

Each list shows its first 20 items and how many more there are, counting up to 1,000 of each.

The page is opened exactly like a [gallery screenshot](/docs/security#thumbnails-are-rendered-without-network-access): its own files and a few public CDNs load, nothing else does, and it has no cookies. Requests to other servers are listed as not loaded, even though they may work in people's browsers. Inspecting only works on servers that render thumbnails (`CHROME_PATH`, see [Configuration](/docs/configuration)); elsewhere it answers that it isn't available. It counts toward its own [limit](#limits).

### rename_artifact

Changes a page's title without publishing a new version. The same rules as renaming in the app apply: editors only, 1 to 200 characters, spaces around it are trimmed.

### set_artifact_visibility

Changes who can open a page without publishing a new version, and sets up its public link: when it expires, a password, or a reset that replaces it. For people who can edit the page. Pass at least one argument besides `artifact_id`.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `visibility` | no | `private` (restricted), `organization` or `link` |
| `link_expires` | no | When the link stops working for people with no access of their own: a date (`2026-12-31`, the end of that day in UTC) or an ISO 8601 date and time. An empty string or `never` removes it. |
| `link_password` | no | A password people enter to open the page by its link, at least 8 characters. An empty string removes it. |
| `rotate_link` | no | `true` resets the public link: public links shared before then work like a page that doesn't exist. The page keeps its id and its own link, which people with access keep using. |

When the page is shared by link, the answer ends with its `Public link`, to hand to people without access of their own; `Link` is the page's own address. The expiry, the password and the key only apply while `visibility` is `link`. See [Link expiry, password and reset](/docs/sharing#link-expiry-password-and-reset).

### share_artifact

Shares a page with people by email, as `viewer` or `editor`, with an optional message. They get an email with the link. When someone isn't emailed (the server doesn't send email, the email failed, or the address got many emails today), the answer lists a link for each of them to pass on; see [People who aren't emailed](/docs/sharing#people-who-arent-emailed). For people who can edit the page. It counts toward the `invite` [rate limit](#limits), with invitations in the app.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `emails` | yes | Email addresses to share with, 1 to 20 at a time |
| `role` | no | `viewer` (the default) can open the page; `editor` can also publish new versions and share it |
| `message` | no | A note included in the email; the email shows its first 500 characters |

### delete_artifact

Deletes a page, like **Delete** in the app: the link stops working for everyone and every version is deleted. It can't be undone. Only the page's owner can delete it, with an agent connected to the page's workspace; editors and organization admins can't.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |

### list_versions

Lists every version of a page, newest first, as the [version history](/docs/version-history) shows them: when each was published, by whom, with which agent, and which version a restore came from. Editors only.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |

### diff_versions

What changed between two versions of a page, like **Compare** in the [history](/docs/version-history#comparing-two-versions), so an agent can check its own change after publishing. It lists the files added, removed and changed, with their sizes and types, and a unified diff (as `diff -u` writes it) of each text file: HTML, CSS, JavaScript, JSON, SVG, Markdown, plain text, CSV and XML. Editors only.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `from` | yes | The older version number, from `list_versions` |
| `to` | yes | The newer version number, from `list_versions` |

A changed file shows without a diff when it isn't text (images, fonts, audio, video), when either version of it is bigger than 200 KB, or when more than 2,000 of its lines changed. One comparison reads up to 2 MB of text and returns up to 1 MB of diff; files past that show as changed without one.

### list_views

How many times each version of a page was opened, and who opened it in the last 90 days with when they last did, like **Views** in the app. Visits through a link shared with **Anyone with the link** are counted but anonymous. Editors only. See [Who opened a page](/docs/sharing#who-opened-a-page) for what is recorded.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |

### restore_version

Makes an older version current again, like **Restore this version** in the history: its HTML and files are published again as a new version, and the link stays the same. Editors only. The new version comes back as structured content too, like `publish_artifact`.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `version` | yes | The version number to restore, from `list_versions` |

### download_artifact

Returns a link that downloads a version of a page as a zip: `index.html` and every file, at the paths the page uses. The agent fetches it itself, for example with `curl`, so this is for agents that can run shell commands or make HTTP requests; others read the files one at a time with `get_artifact`.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `version` | no | A version number from `list_versions`. Without it, the current version. Older versions are for editors only. |

The link needs no sign-in, but it only works for the person the agent is connected as, for that version, and for 12 hours. Access is checked again each time it is used, so it stops working if that person loses access to the page.

### list_comments

Reads the [comments](/docs/comments) on a page: threads oldest first, each with its replies, the author, the agent it was posted through (if any) and the version that was current when it was written. A thread [pinned to an element](/docs/comments#pinning-a-comment-to-an-element) also says which: its CSS selector, the HTML file it is in, the version it was picked on, the element's text then and roughly where it was on the page. Resolved threads are left out unless `include_resolved` is set. For anyone who can open the page. Agents are told to read comments before publishing a new version, and `get_artifact` says how many threads are open.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `include_resolved` | no | `true` to list resolved threads too |
| `limit` | no | How many threads, 1 to 100; 50 when left out |
| `cursor` | no | The cursor from the end of the previous answer, for the next threads |

### add_comment

Starts a new comment thread on a page, for example to say what a new version changed, optionally pinned to one element. The comment is posted as the person the agent is connected as, marked with the agent's name.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `body` | yes | Plain text, up to 5,000 characters |
| `anchor` | no | Pins the comment to one element of the page, shown there in the viewer: `selector` (a CSS selector, up to 500 characters, required), `snippet` (the element's text, up to 200 characters, to find it again if the selector stops matching), `path` (the HTML file, `index.html` when left out) and `version` (the current one when left out). Left out, the comment is about the whole page |

### reply_comment

Replies in the thread of a comment, as the connected person, marked with the agent's name. Replying to a reply adds to the same thread, and a reply reopens a resolved thread.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `comment_id` | yes | A `comment_id` from `list_comments` |
| `body` | yes | Plain text, up to 5,000 characters |

### resolve_comment

Resolves the thread of a comment, or reopens it. For the person who started the thread and people who can edit the page.

| Argument | Required | Meaning |
| --- | --- | --- |
| `artifact_id` | yes | Id or link of the page |
| `comment_id` | yes | A `comment_id` from `list_comments`; a reply's id resolves its thread |
| `resolved` | no | `false` reopens the thread; `true` when left out |

## Publishing by direct upload

With `publish_artifact`, a page travels inside the MCP call, so it is limited by what the agent and the server can send in one request: the server takes MCP requests up to 4 MB, and hosts like Vercel refuse requests over about 4.5 MB. Agents that can run shell commands or make HTTP requests (Claude Code, Cursor, Codex and other coding agents) can use `prepare_upload` and `publish_upload` instead, and the files go straight to storage:

1. The agent lists the files with their sizes and hashes. The server checks them against the same rules and limits as above, and nothing is published yet.
2. The agent uploads each file to its link, for example with `curl -T`.
3. On `publish_upload`, the server hashes every uploaded file itself. A file that is missing, or whose bytes don't match its size and hash, stops the publish with a message, and nothing is published.

Files already stored in one of your own pages, like the images of a page you publish a new version of, need no upload. Uploads that are never published are deleted 1 to 7 hours later: the storage sweep, every 6 hours, removes the ones over an hour old.

Agents that can't make requests of their own keep using `publish_artifact`.

Direct upload is also easier on the server. An inline page arrives as one large JSON request, with images and fonts in base64, and the server reads and parses all of it before it can answer anything else. It decodes and hashes large pages on worker threads, but many agents publishing large pages at once still slow every request down. With direct upload the files go to storage without passing through the server. If you run a server where agents publish sites with images, fonts or media, or pages over about 1 MB, set `S3_PUBLIC_ENDPOINT` so they can (see [Configuration](/docs/configuration#object-storage)).

## Command line

The `the-artifact` command publishes a folder or an HTML file from a terminal or a CI job, without an agent. It needs Node.js 20 or later:

```sh
npx @the-artifact/cli publish ./dist --server {{APP_URL}}
```

or installed once with `npm install -g @the-artifact/cli`, then run as `the-artifact`.

### Signing in

```sh
the-artifact login --server {{APP_URL}}
```

opens your browser at the same sign-in and workspace choice as [connecting an agent](/docs/connect-your-agent#choosing-a-workspace). The CLI then shows under **Account settings → Connected agents** as **The Artifact CLI**, and pages it publishes are marked with that name in the [history](/docs/version-history). The server you sign in to becomes the default, so later commands don't need `--server`. With no `--server`, no `THE_ARTIFACT_URL` and no sign-in, the CLI uses the hosted service, https://the-artifact-pi.vercel.app.

| Command | What it does |
| --- | --- |
| `the-artifact login` | Signs in with the browser. `--no-browser` prints the link instead of opening it. |
| `the-artifact login --with-token < token.txt` | Saves an [access token](/docs/connect-your-agent#publishing-from-ci) read from standard input instead, for a machine with no browser. |
| `the-artifact whoami` | Shows the account and workspace the CLI publishes to, and checks the sign-in still works |
| `the-artifact logout` | Removes the saved sign-in and disconnects it on the server |

Sign-ins are saved per server in `~/.config/the-artifact/credentials.json` (`%APPDATA%\the-artifact` on Windows, `$XDG_CONFIG_HOME/the-artifact` when that is set), readable only by you. Signing in over SSH needs a browser on the same machine; on a server, use `--with-token` or `THE_ARTIFACT_TOKEN`.

### Publishing

```sh
the-artifact publish ./dist
```

publishes `dist/index.html` as the page and every other file in the folder next to it, then prints the link. Hidden files and folders, `node_modules`, and files of types pages can't hold are left out, with a note for each. Links to folders aren't followed, and links to files are followed only to files inside the folder that would be published anyway; a link to a file outside it or to a hidden file is left out with a note. A single file works too: `the-artifact publish report.html`. The [size limits](#what-makes-a-good-page) are checked before anything is sent.

| Option | Meaning |
| --- | --- |
| `--title <title>` | The page's title. By default the HTML's `<title>`, or the folder's name. |
| `--id <page>` | Publish a new version of this page, by its id or link. Empty, it publishes a new page. |
| `--entry <path>` | The HTML file in the folder that is the page, instead of `index.html` |
| `--visibility <who>` | `restricted`, `organization` or `link` |
| `--folder <name>` | File the page into this [folder](#folders); `""` takes it out |
| `--ignore <glob>` | Leave out matching files, like `'*.map'` or `drafts/`; repeat for more. A pattern without a `/` matches names at any depth. |
| `--only <path>` | Send only this file, or the files matching this glob, and keep the page's other files as they are; repeat for more. See [Updating some files](#updating-some-files). |
| `--remove <path>` | Remove this file from the page and keep the others; repeat for more |
| `--save` | Remember the page in `.the-artifact.json` in the current folder, so publishing the same path again publishes a new version of it. Commit the file to share it. |
| `--new` | Publish a new page even when `.the-artifact.json` has one for this path |
| `--watch` | Keep watching, and publish a new version whenever files change. See [Watching a folder](#watching-a-folder). |
| `--poll` | With `--watch`, look for changes every second instead of waiting for file events |
| `--dry-run` | List what would be sent, and send nothing |

The link is the only thing printed on standard output, so `url=$(the-artifact publish dist)` captures it. Progress and notes go to standard error.

When `.the-artifact.json` names the page, the first line on standard error says which one: `Publishing to https://artifact.example.com/a/k3v9x2m8pq, the page .the-artifact.json names for dist.` The file travels with the repository, so in a folder someone else gave you, check that line, or the file, before you publish: it can name a page of theirs that they shared with you to edit, and then they see what you publish. `--new` ignores the file.

### Updating some files

A dashboard published once and refreshed by a job needs only its data sent again. With `--only`, `publish` sends just the files you name and keeps every other file of the page's current version, like [`update_files`](#update_files):

```sh
the-artifact publish ./dashboard --id k3v9x2m8pq --only data.json
```

`--only` takes paths relative to the folder, or globs like `'data/*.json'`, and can be repeated. The folder needn't hold the rest of the page, so the job only has to write the files it changes. `--only index.html` replaces the page itself. `--remove old.css` removes a file, and works with or without `--only`. It needs the page: `--id`, or a page saved with `--save`. The title stays as it is unless you pass `--title`.

For example, a cron job that refreshes a dashboard every hour:

```sh
# crontab: 0 * * * * /opt/dashboard/refresh.sh
set -e
cd /opt/dashboard
./export-metrics > site/data.json
THE_ARTIFACT_TOKEN=$(cat token.txt) npx @the-artifact/cli publish site --id k3v9x2m8pq --only data.json
```

Each run is a new version in the [history](/docs/version-history), with the same limits and quota as any other, and the page's link stays the same. Storage counts every version in full, so a job that runs often reaches a workspace's storage or version [quota](#limits) sooner, where the server sets one; [version retention](/docs/retention) keeps the history short.

### Watching a folder

```sh
the-artifact publish ./dist --watch
```

publishes the page, then keeps watching the folder while you work. Half a second after the last change, it publishes a new version of the same page and prints its link again (one line per version; with `--json`, one JSON object per line). Anyone who has the page open sees the new version within a few seconds without reloading (see [Version history](/docs/version-history#live-updates)).

- It publishes to the page from `--id` or `.the-artifact.json` when there is one, otherwise to the page its first publish creates. `--save` remembers that page.
- Files `publish` leaves out (hidden files and folders, `node_modules`, `--ignore` patterns) and `.the-artifact.json` never trigger a publish. Saving a file without changing it publishes nothing.
- `--visibility` and `--folder` apply to the first publish only, so changes made in the app meanwhile stay.
- A publish that fails, like a folder with no `index.html` halfway through a build or a [limit](#limits) reached, prints the message and waits for the next change. Only a refused sign-in ends the watch.
- When the server takes [direct uploads](#publishing-by-direct-upload), each version sends only the files that changed; the others are already stored. Otherwise the whole page is sent each time.
- It always sends the whole folder, so it doesn't go with `--only` or `--remove`.
- Ctrl+C stops watching. `--poll` looks for changes every second instead of waiting for file events, for network drives and mounted folders where those don't arrive.

Each version counts toward the server's publish [limit](#limits), so a build that writes files for a long time is better watched once it's done: point `--watch` at the build's output folder rather than at the sources.

### Listing and sharing

| Command | What it does |
| --- | --- |
| `the-artifact list` | Lists the pages in the workspace, newest first: id, version, who can open it, folder and title. `--query <words>` searches titles and page text, `--folder <name>` narrows to a folder, `--tag <tag>` to pages with that [tag](#tags), `--limit <n>` (1 to 100) and `--cursor` page through. |
| `the-artifact share <page> --visibility link` | Changes who can open a page: `restricted`, `organization` or `link` |
| `the-artifact share <page> --expires 2026-12-31 --password <text>` | The link stops working after that day (UTC), and asks for the password. `--expires never` and `--password ""` remove them. |
| `the-artifact share <page> --new-link` | Resets the public link and prints the new one; public links shared before stop working. The page keeps its id. |
| `the-artifact share <page> --email ana@example.com` | Shares a page with people by email; repeat `--email` for more. `--role editor` lets them publish new versions too, and `--message` adds a note to the email. |

### In CI

Set `THE_ARTIFACT_TOKEN` to an [access token](/docs/connect-your-agent#publishing-from-ci) and `THE_ARTIFACT_URL` to `{{APP_URL}}`, and every command uses them instead of a saved sign-in:

```yaml
- name: Publish the report
  env:
    THE_ARTIFACT_URL: {{APP_URL}}
    THE_ARTIFACT_TOKEN: ${{ secrets.ARTIFACT_TOKEN }}
  run: npx @the-artifact/cli publish report --title "Test report" --id "${{ vars.REPORT_PAGE_ID }}"
```

`--token <token>` works too, but a token on the command line can end up in shell history and process lists.

| Setting | Meaning |
| --- | --- |
| `THE_ARTIFACT_URL` | The server, like `--server` |
| `THE_ARTIFACT_TOKEN` | An access token, like `--token`. It takes precedence over a saved sign-in. |
| `THE_ARTIFACT_CONFIG_DIR` | Where sign-ins are saved, instead of the folder above |

Every command takes `--json` to print JSON for scripts: `publish` prints the same answer as [`POST /api/publish`](#publishing-without-an-agent), and `list` prints `{ "pages": [...], "total", "cursor" }`. A command that fails prints the server's message and exits with `1`, or `2` when the command line itself is wrong.

## Publishing without an agent

CI jobs and scripts publish with a plain HTTP request to `POST {{APP_URL}}/api/publish`, authorized by an [access token](/docs/connect-your-agent#publishing-from-ci) as `Authorization: Bearer art_…`. It takes the same things as `publish_artifact`, publishes to the token's workspace with the same rules, limits and quotas, and answers with the link. The endpoint is stable: scripts and tools can rely on it.

Send either JSON (`Content-Type: application/json`) with the fields of [publish_artifact](#publish_artifact):

```json
{
  "title": "Nightly dashboard",
  "html": "<!doctype html>…",
  "files": [{ "path": "chart.js", "content": "…" }, { "path": "img/logo.png", "content": "iVBORw0…", "encoding": "base64" }],
  "artifact_id": "k3v9x2m8pq",
  "visibility": "organization",
  "folder": "Reports"
}
```

or multipart form data, which is easier from a shell because files go up as they are:

| Part | Meaning |
| --- | --- |
| `title`, `artifact_id`, `visibility`, `folder` | Text fields, as in `publish_artifact` |
| `index.html` | The page itself, as a file or text |
| Any other name | A file of the page, named by its path: `css/site.css`, `img/logo.png` |

```sh
curl -fsS {{APP_URL}}/api/publish -H "Authorization: Bearer $ARTIFACT_TOKEN" \
  -F 'title=Test report' -F 'index.html=@report/index.html' -F 'css/site.css=@report/css/site.css'
```

#### Updating some files

With `mode` set to `update`, the request changes only some files of a page and keeps the rest of its current version, as [`update_files`](#update_files) does. `artifact_id` is required, `title` is optional (the page keeps its own), and the page itself is only sent to replace it:

```json
{
  "mode": "update",
  "artifact_id": "k3v9x2m8pq",
  "files": [{ "path": "data.json", "content": "{\"visitors\": 1204}" }],
  "remove": ["old.css"],
  "base_version": 7
}
```

As a form, `mode=update` is a text field, each path to remove is a `remove` field of its own, and the files are file parts as above:

```sh
curl -fsS {{APP_URL}}/api/publish -H "Authorization: Bearer $ARTIFACT_TOKEN" \
  -F mode=update -F artifact_id=k3v9x2m8pq -F 'data.json=@dashboard/data.json'
```

`base_version` is optional; when it isn't the page's current version, the request answers `409` and nothing is published.

A new page answers `201`, a new version (with `artifact_id`) `200`, both with:

```json
{
  "id": "k3v9x2m8pq",
  "url": "{{APP_URL}}/a/k3v9x2m8pq",
  "title": "Test report",
  "version": 1,
  "visibility": "private",
  "folder": null
}
```

Errors are JSON `{ "error": "…" }` with a message to show as is, sometimes with the `field` it is about: `400` for a page that can't be published (a bad file, a full workspace, an `artifact_id` you can't edit), `409` for an update whose `base_version` is no longer current, `401` for a missing, expired or revoked token, `413` for a request over the size limit, `415` for another content type, and `429` with `Retry-After` past the `publish` [rate limit](/docs/configuration#rate-limits). Hosts like Vercel refuse requests over about 4.5 MB before they reach the server; for larger pages, run an agent with the token and use [direct upload](#publishing-by-direct-upload). The [command line](#command-line) sends pages the same way, so the same limit applies to it.

To check a token before relying on it, `GET {{APP_URL}}/api/whoami` with it as the bearer token answers with whom it acts for and where it publishes, or `401` like above:

```json
{ "email": "ana@example.com", "name": "Ana", "workspace": { "id": null, "name": "Personal" }, "client": "GitHub Actions" }
```

`workspace.id` is the organization's id, or `null` for a personal workspace, and `client` is the token's name (or the agent's, for an agent's sign-in).

## Pages in the chat

An agent that supports [MCP Apps](https://modelcontextprotocol.io/extensions/apps) (the `io.modelcontextprotocol/ui` extension) shows a page under the tool call that made it, instead of a link: `publish_artifact`, `update_files`, `publish_upload`, `restore_version` and `duplicate_artifact` name the server's viewer (`ui://the-artifact/viewer`) in their `_meta.ui.resourceUri`, and the agent frames it next to the answer. The viewer is a small document of its own, with no scripts from anywhere else, that frames the page's current version and offers **Open in The Artifact**. Agents without the extension see the text and the link as before.

The viewer runs with your own authorization: it asks the server, through the same connection the agent uses, for the resource `artifact://<id>/view`, which answers with the page's current version under a [link signed for you](/docs/security#framing-and-embeds) (or `{ "error": "…" }` for a page that is gone or not yours to open), and frames that. So it shows restricted and organization pages, which [embeds](/docs/sharing#embedding) on other sites can't; someone else who reads the same chat sees the page only if the agent connected as them and they can open it. The link names you and expires after 12 hours; the viewer asks for a fresh one each time the chat shows the call again, and nothing of it is kept in the chat.

The agent's own frame has no origin, so a server that narrows `EMBED_FRAME_ANCESTORS` to a list of sites keeps the viewer out too: leave it unset (the default) on a server whose agents show pages this way.

## Limits

Besides the size of each page, a server limits how fast an account uses these tools and how much a workspace holds. Past a limit, the tool answers with an error that says so and what to do, and the agent tells you.

| Limit | Default |
| --- | --- |
| Tool calls, by every agent of one account together | 600 per 10 minutes |
| New pages and versions (`publish_artifact`, `update_files`, `publish_upload`, `restore_version`, `duplicate_artifact`, `POST /api/publish`) | 200 per hour |
| Upload links from `prepare_upload`, by the size of the files still to upload | 2048 MB per hour |
| People shared with by email (`share_artifact`, counted with invitations in the app) | 200 per hour |
| Comments and replies (`add_comment`, `reply_comment`, counted with comments in the app) | 120 per hour |
| Page inspections (`inspect_artifact`) | 100 per hour |
| Pages, versions and storage in a self-hosted workspace | None, unless the server sets them |
| A personal workspace on the hosted service's free Personal plan | 50 pages and 1 GB of storage; versions older than 7 days are removed |

A rate limit ends on its own: the message says how long to wait. For a full workspace, delete pages you no longer need in the gallery, or publish a new version of a page you have instead of a new page. Storage counts every version of every page in full, so a page with many large versions uses more. Self-hosted servers can change all of these; see [Rate limits](/docs/configuration#rate-limits) and [Workspace quotas](/docs/configuration#workspace-quotas).

## Updating a page

Ask for the change in the same conversation ("make the chart a line chart"), or point the agent at the page's comments ("deal with the open comments on the launch plan"). The agent reads the page with `get_artifact` (and any file it needs with `path`) and the feedback with `list_comments`, edits it and publishes with the same `artifact_id` and the full set of files, or with `update_files` and only the files it changed. The link stays the same, the version number goes up, and the old version stays in the [history](/docs/version-history).

## Managing pages in the app

In the gallery and the page viewer, the **…** menu lets anyone who can open a page **Download** it as a zip of `index.html` and its files or, once signed in, **Duplicate** it; lets editors rename it, change its **Tags** and move it to another workspace; and lets the owner delete it. See [Duplicating and moving pages](/docs/sharing#duplicating-a-page). In the viewer, **Download** saves the version you are looking at, including an older one picked in the history.

On servers that render thumbnails, the viewer's **…** menu also has **Download PDF**: the server prints the version you are looking at and saves it as a PDF, which takes a few seconds the first time. A version never changes, so its PDF is kept and the next download of it is immediate. It prints like a browser's Print on a computer, with the page's backgrounds kept. Pages that have print styles (`@media print`) look their best: a page can set its paper size and margins with `@page` (for a deck, `@page { size: 1280px 720px; margin: 0 }`), and otherwise it goes on A4 with 1 cm margins. A deck that shows one slide at a time prints only that slide unless its print styles show them all. Ask the agent to add print styles when you want a page to print well. Like [inspections](#inspect_artifact), the page is printed with only its own files and a few public CDNs, so anything it loads from other servers is missing from the PDF.

**Full screen** in the viewer shows the page alone, without the app's header, for presenting it. The page's own keys (a deck's arrow keys, say) work straight away, and Esc goes back.

The gallery shows the newest pages first and loads more as you scroll, so a workspace with thousands of pages opens as fast as one with ten. The search box, the folders and the tags above it narrow the list, and they combine: for example the pages tagged `q3` in the folder Reports that mention "revenue".

## Search

The search box in the gallery, and `query` in `list_artifacts`, find a page when:

- **its title contains what you typed**, anywhere and ignoring case (`port` finds "Weekly report"), or
- **the text of its current version has every word you typed**, or words that start with them, ignoring case: `quarterly rev` finds a page that says "Quarterly revenue". Words match whole or from their start, so `venue` doesn't find "revenue".

The text is what a reader sees: the words of the page's HTML files, without markup, scripts, styles or comments. Data files (JSON, CSV, JavaScript) aren't searched, nor what a script draws on the page after it loads. Words are matched as written, in any language, without stemming (`chart` doesn't find "charts"; `chart` as the start of "charts" does). Text in scripts without spaces between words, such as Chinese or Japanese, is found from the start of a run of characters only. Search reads the first 200,000 characters of a page's text.

Search only looks at the pages the list shows you, and at the text of the ones you can open. An organization's gallery lists pages shared by link to every member, but a link with a password, a reset link or an expired one opens only through the link; members find those by their title only, unless the page is shared with them. Older versions aren't searched: after a new version, or a restore, the page is found by the words it has now. A long page can take a few seconds after publishing to be found by its text.

## Tags

Tags are short labels on a page, like `q3`, `draft` or `design review`. They work across folders: a page is in one folder but can have several tags.

- **Editors add and remove them**: choose **Tags** in the page's **…** menu, in the gallery or the viewer, type one or several separated by commas and press **Enter**. Or ask your agent (it uses `tag_artifact`). Changing tags doesn't change when the page was last updated.
- **Everyone who can open the page sees its tags**, on its card and in the viewer. A link-shared page in an organization that is closed to you, with a password, a reset link or an expired link, is still listed, but without its tags or comment count, and filtering by a tag leaves it out.
- **Tags are lowercase**, 1 to 32 characters, without commas, and a page has up to 10.
- **Filter by a tag** by picking it above the gallery, or on a card. The tags above the gallery are those of the pages you see in the workspace, with how many pages have each. Tags belong to the page's workspace; pages shared with you show their tags too, and filtering by one works in **Shared with you** as well.

## Folders

Folders group the pages of one workspace: your personal workspace, or an organization, where they are shared by everyone in it. They are one level deep, and each name is used once per workspace, whatever its case.

- **Folders never change who can open a page.** A restricted page in a folder stays restricted, and people only see the pages they could open anyway. Folder counts only count those.
- **Anyone who can publish in the workspace organizes its folders**: you in your personal workspace, and every member of an organization. They create folders with **New folder**, and pick one above the gallery to **Rename** it or **Delete folder**.
- **To file a page**, choose **Move to folder** in its **…** menu, or ask your agent (it uses `move_artifact`, or `folder` when it publishes). Filing a page takes edit access to it, and doesn't change when it was last updated.
- **Deleting a folder keeps its pages.** They stay in the workspace, in no folder.
- **Pages shared with you** from someone else's workspace show without their folder: folders belong to the workspace that owns the page. You file only the pages of your own workspaces.

Folders are the lighter answer to one company with several divisions: an [organization](/docs/organizations) can be a division, and folders sort pages within it.

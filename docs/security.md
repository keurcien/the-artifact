# Security

## Pages are sandboxed

Pages render in an `<iframe sandbox>` without `allow-same-origin`, so they run with an opaque origin. Their scripts work, but they can't read the app's cookies or storage, call its API with your session, or touch the page around them.

Each version is served as its own document tree, so a page's files resolve by relative paths:

```
/api/artifacts/<id>/v/<version>/            the entry HTML
/api/artifacts/<id>/v/<version>/<path>      its CSS, JS, images, fonts, data
```

- Every response, not just HTML, carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads`, so a page, an SVG or an extra HTML file opened on its own is sandboxed too. `X-Content-Type-Options: nosniff` and a fixed content type per extension stop files being read as something else.
- The access rules are the page's: the current version for anyone who can open the page, older versions for its editors only, like the history. A page you can't open answers 404, as if it didn't exist.
- A sandboxed frame has no origin of its own, so browsers don't send your session cookie with the requests it makes for its files. When opening a page needs to know who you are (anything not shared by link, and every older version), the frame's first request, which does carry the cookie, is redirected to `/v/<version>/~<link token>/`, and the page's relative URLs resolve under it. The token is signed by the server, names you, the page and the version, and expires after about 12 hours. Access is checked again on every request, so removing someone from a page locks them out of its files at once. Other pages can't learn a token, so they can't load another page's files with your access.
- **Download** (`/api/artifacts/<id>/download`) serves a version's files as one zip with the same rules, as an attachment that the browser saves rather than opens. The link an agent gets from `download_artifact` carries the same kind of token, for the person the agent is connected as and one version, so it works without a session and is checked again each time it is used.
- Files are sent with `Access-Control-Allow-Origin: *` so the sandboxed page can `fetch()` its own data and load its fonts. Browsers never combine `*` with credentials, so this exposes nothing a signed-out visitor couldn't already open.
- Versions never change, so a page's files are cached privately in your browser for an hour and revalidated by hash. The entry HTML file is the exception: it is sent with `Cache-Control: private, no-cache`, so the browser checks it again on every open and each visit can be counted as a view; an unchanged page answers with a short 304.
- **Link keys and passwords.** After a reset, a public link carries a random key (`?k=`), compared in constant time; the page's own address only opens it for people with access of their own. Link passwords are stored as scrypt hashes, like account passwords, and compared in constant time. Passing the key and the password sets an `HttpOnly` cookie that only goes to that page's addresses under `/api/artifacts/<id>` and lasts 12 hours. It holds a signature over the page, its key and its password, so a reset or a new password makes every earlier one useless. The frame's first request carries it and is redirected to `/v/<version>/~<grant>/`, the same signature in the path, like a link token. Wrong passwords are limited per page and per network (see [Rate limits](/docs/configuration#rate-limits)).

## Comments on an element

People can [pin a comment](/docs/comments#pinning-a-comment-to-an-element) to an element of a page. The page runs in its sandboxed frame with an opaque origin, and nothing about pinning gives it any access to the app:

- **The helper is part of the page.** When a signed-in person opens a page, the viewer loads it from `/v/<version>/[~<link token>/]~comments/…`. For that address, and only that one, the server adds one small inline script to the page's HTML files, right after the doctype, with the same `Content-Security-Policy: sandbox …` header as always. Relative links inside the page keep the `~comments/` part. Signed-out visitors, embeds and thumbnails get the page as published. The script runs with the page's own (lack of) privileges, and the page's scripts can read it, change it, remove it or send its messages themselves. So it adds nothing a page couldn't already do: any page can already post messages to the window that frames it.
- **Only postMessage.** The helper and the app talk only with `postMessage`. The app sends it the selectors and texts of the pinned comments on the page shown, which came from the page in the first place, and never comment bodies, authors, ids or anything of the app. The frame has an opaque origin, so there is no origin to name as the target.
- **Every message from the frame is untrusted data.** The app accepts a message only when its `source` is its own frame's window, parses it into a fixed shape (a selector of at most 500 characters without control characters, a text folded to at most 200, an HTML file path by the same rules as page files, bounded numbers), and drops anything else. A picked element counts only while the person is picking, after they chose **Pin to an element**. Its text is shown as text, never as HTML, and it is stored only when the person then writes the comment and posts it in the app's own panel. Pins are drawn by the app over the frame from the numbers the helper reports; a page can move or hide its own pins, and nothing more.
- **The server checks the anchor again.** `POST /api/artifacts/<id>/comments` and `add_comment` treat an anchor like any other input: a version the page has, the lengths above, no control characters, a path that is one of the page's HTML files, and a position of four numbers from 0 to 1. Unknown fields are dropped. Agents get the selector and text quoted, and are told to treat comments as feedback, not instructions.

A page whose scripts stop the helper only loses pinning; comments on the whole page work as before.

## A separate domain for pages

The sandbox is the first line. With `CONTENT_ORIGIN` set (see [A separate domain for pages](/docs/self-hosting#a-separate-domain-for-pages)), page files are served only from that second origin, so a page that got out of its sandbox through a browser bug still wouldn't be on the app's site:

- **The app's cookies never go there.** Every cookie the app sets (the session, pending sign-ins, the link password grant, sign-in flows) is host-only, with no `Domain`, so the browser sends it only to `APP_URL`'s host. With the content origin on another registrable domain, `SameSite` keeps them out of its requests too, and a page there can't set cookies for the app's domain. The one cookie that is `SameSite=None` is the short-lived one tying a [SAML](/docs/saml) sign-in to your browser, because the identity provider posts back from its own site; its path, `/api/auth/sso/saml`, keeps it off every page's requests.
- **The content host never reads or sets a cookie.** It gets in only by what the address carries: a link token naming a signed-in viewer, a grant for a link's key and password, or the link's key. The same tokens as above, checked again on every request.
- **It can't act as the app.** It answers only `/api/artifacts/<id>/v/<version>/…`. Sign-in, the API, MCP, OAuth, embeds, link previews and the web app answer 404 there, so a page can't send people to a sign-in form on it, and a request to it can't do anything the app would do.
- **The app's host serves no page content.** A request for a page's files on the app's host is checked with the session, key and grant as before, then redirected to the content origin under a token, or answered 404.
- **Framing.** When `EMBED_FRAME_ANCESTORS` narrows framing, page content lists the app's origin as well, since the app's viewer and embeds frame it from there. Embeds frame the content origin directly, and their `frame-src` names it.

Without `CONTENT_ORIGIN`, pages are served from `APP_URL`, isolated by the sandbox alone.

## Framing and embeds

- **The app can't be framed by other sites.** Every page of the app, `/a/<id>` included, is sent with `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'` and `X-Frame-Options: SAMEORIGIN`, so another site can't lay it out under its own buttons (clickjacking), and the app loads no plugins and keeps its links pointing at itself. Every response of the app and the API also carries `X-Content-Type-Options: nosniff`, so browsers never read a file as a type other than the one it is sent with.
- **HTTPS only, once a browser has seen it.** When `APP_URL` starts with `https://`, every response carries `Strict-Transport-Security: max-age=31536000`, so a browser that has been to the server never tries plain HTTP to it again for a year, and nobody on the network can strip the encryption from a later visit. It covers the app's own host name only, not other hosts on the domain.
- **Embeds can.** `/e/<id>` is a small document of its own, without the app: no app scripts, no session, only a sandboxed frame of the page's current version and a link to open it. Its policy is `default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'`, with the content origin added to `frame-src` when there is one. Page content (`/api/artifacts/<id>/v/<version>/`) is framed by the app and by embeds, so the same sites may frame both.
- **Who may embed.** By default any site; `EMBED_FRAME_ANCESTORS` narrows that to a list of origins, sent as `frame-ancestors 'self' <origins>` on embeds and page content (see the [configuration reference](/docs/configuration)). With the default, no `frame-ancestors` is sent at all, since `*` wouldn't match sites that frame embeds from a sandboxed frame of their own.
- **Embeds are never signed in.** Access is checked as a visitor who isn't signed in, ignoring any session cookie, so an embed shows the same thing to everyone. Only pages shared with **Anyone with the link**, with no password and not expired, are embedded. Every other page, and every page that doesn't exist, gets the same "Sign in to view this page" card with no title, content or screenshot, and `GET /api/oembed` answers 404 for them. This also means a site can't use your session to show you a restricted page inside its own frame.
- **The MCP Apps viewer acts for the agent's person.** An agent that supports MCP Apps shows a published page under the tool call ([Pages in the chat](/docs/publishing#pages-in-the-chat)). Its viewer, `ui://the-artifact/viewer`, is served over MCP like a tool answer and runs in the agent's own sandboxed frame, where no cookie of this server is sent. To frame a page it reads the resource `artifact://<id>/view` over the agent's connection, authorized by the agent's token, and gets the page's current version under a content link signed for that person: the same kind the app's own viewer uses, checked again on every request and expiring after 12 hours. So the viewer shows exactly what that person could open, restricted pages included, and nothing to anyone else. The agent's frame has no origin, so `EMBED_FRAME_ANCESTORS` must stay unset for the viewer to work.

For the strongest isolation on a public install, serve The Artifact on a domain of its own rather than a subdomain of sites that share cookies, and its pages from a [separate domain](#a-separate-domain-for-pages).

## Thumbnails are rendered without network access

Gallery cards show a screenshot of each page, taken on the server in headless Chromium after it is published. Page HTML is untrusted and its scripts run during the render, so:

- **No network of its own.** Every request the page makes is intercepted. The page's own files are answered from memory, never over the API or the network. Everything else is refused, except `GET` requests to a short list of public CDN hosts (jsDelivr, unpkg, cdnjs, esm.sh, Google Fonts and a few more; see `THUMBNAIL_CDN_HOSTS` in the [configuration reference](/docs/configuration)). The server fetches those itself, over HTTPS on port 443, only when every address the host resolves to is public, and connects to the address it checked, so a name can't be pointed at the server's own network in between. Private, loopback, link-local (including the cloud metadata address `169.254.169.254`), shared, multicast and reserved ranges are refused, and so are IPv6 forms that embed an IPv4 address. Redirects go through the same check.
- **A backstop.** Chromium is pointed at a proxy that doesn't exist, localhost included, so traffic that interception might not see (WebSockets, workers) goes nowhere. WebRTC can't send UDP, and DNS prefetching is off.
- **A clean, short-lived browser.** Each render gets a fresh browser context: fixed 1280×720 viewport, no downloads, no service workers, no storage carried over. It has 8 seconds to load and 20 to finish. A page that hangs is abandoned and the browser restarted, without cutting short the other renders still on it.
- **Chromium's own sandbox stays on.** Chromium runs with its sandbox and without the server's environment variables (no database URL or SMTP password). In Docker, the sandbox needs to create namespaces, which Docker's default seccomp profile forbids; `deploy/docker-compose/docker-compose.yml` runs the app with `deploy/seccomp-chromium.json`, which is Docker's default profile plus `clone`, `unshare` and `setns`. Without it, thumbnails are skipped and the log says why.
- **Nothing blocks publishing.** Renders run in the background, two at a time unless `THUMBNAIL_CONCURRENCY` says otherwise. Renders that run at once share one Chromium, but each has its own browser context and its own interception, so one page never sees another's files, storage or requests. If there is no browser, or a render fails, the card keeps its sketch.

When an agent checks a page with [`inspect_artifact`](/docs/publishing#inspect_artifact), the page is opened in the same Chromium under exactly these rules: the same interception, CDN list, proxy, timeouts and fresh context, with no cookies. Only the viewport differs (1280 or 390 pixels wide). The accessibility checker, axe-core, ships with the server and runs in a separate JavaScript world, so the page can neither see nor change it. Inspections run at most `THUMBNAIL_CONCURRENCY` at a time besides thumbnails, are for the page's editors only, and have their own rate limit. PDFs from **Download PDF** are printed the same way, in a 1280-pixel window, for anyone who can open that version; they take turns with inspections, have their own rate limit, and are sent as a download with `Content-Security-Policy: sandbox`.

Screenshots are served with the same access rules as the page, from `/api/artifacts/<id>/thumbnails/<version>`. Only pages shared with **Anyone with the link**, with no password and not expired, put their title and screenshot in the link preview tags of `/a/<id>`; every other page gets the same generic tags as a page that doesn't exist (see [Link previews](/docs/sharing#link-previews)).

## Webhooks can't reach private networks

[Webhooks](/docs/webhooks) are requests the server makes to an address a workspace admin chooses, so they follow the same rules as thumbnail CDN requests:

- **Public addresses only.** The name is looked up every time something is sent, and the request is refused when any address it resolves to is private, loopback, link-local (including the cloud metadata address `169.254.169.254`), shared, multicast or reserved, or an IPv6 form that embeds an IPv4 address. The server then connects to the address it checked, so a name can't be pointed at the server's own network in between. Addresses that are private on their face (`https://10.0.0.5/`, `https://localhost/`) are refused when the webhook is saved too.
- **HTTPS, no redirects.** Only `https://` addresses are accepted, with the certificate checked for the name, and redirects are never followed: a `3xx` answer is a failed delivery. Plain `http://` to `localhost` is allowed only on a development server run with `pnpm dev`, never on a deployed one, whatever its `APP_URL`.
- **Short and blind.** Each request has 5 seconds in all. Only the status code of the answer is read; its body is thrown away, so a webhook can't be used to read anything back.
- **Nothing private in them.** Messages carry the workspace's name, the page's title and address, the version, the actor's name and a short excerpt of a comment: never page content, email addresses, link keys or passwords. Each is signed with an HMAC-SHA256 secret that is shown once and stored encrypted with a key the server keeps in its database, like single sign-on client secrets.
- **Managed by admins only.** Only an organization's owners and admins see and change its webhooks, and the [audit log](/docs/audit-log) records it. Changes show only the destination's host, never its full address.

## Requests to identity providers

For [single sign-on](/docs/sso) the server downloads a SAML IdP's metadata and an OpenID Connect provider's settings, keys and tokens, from addresses an instance admin enters:

- **No loopback, link-local or reserved addresses.** The name is looked up and the request refused when any address it resolves to is loopback, link-local (including the cloud metadata address `169.254.169.254`), multicast or reserved; the server then connects to the address it checked. A self-hosted install may reach private network addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `fc00::/7`), since company identity providers often run there; the hosted service reaches public addresses only. Loopback is allowed only while `APP_URL` is `http://`, for trying single sign-on locally.
- **No redirects, and small.** Redirects are never followed, each request gives up after 10 seconds, and answers larger than 1 MB are refused as they arrive.
- **Nothing to learn from failures.** The admin form says only that the address couldn't be read, whatever the reason; the reason is in the server's log.

## Private by default

A page in a personal workspace is restricted until you share it. A page that someone can't open looks the same as one that doesn't exist.

A page published in an organization stays with the organization. Its owner can edit, share and delete it only while they are a member there (and not kept out by [two-factor sign-in](#organizations-that-require-it)). Someone who leaves or is removed keeps only what a share with them or the page's link gives, like anyone outside the organization, in the app, through agents and access tokens, and in their account's [data export](/docs/exporting-your-data).

Pages are kept out of search engines. `/robots.txt` asks crawlers to stay away from page links (`/a/`), embeds (`/e/`), page content and the API; a self-hosted install asks them to stay off the whole server, and a separate domain for pages does the same. Chat apps and social sites that unfurl links (Slack, Discord, LinkedIn, X and others) may still read the preview of a page shared with **Anyone with the link**, and only of those.

## Sign-in

- Sign-in links are single-use, expire after 15 minutes and are stored only as a hash.
- Passwords (on servers without email, or once someone sets one) are hashed with scrypt. Wrong ones are [rate limited](/docs/configuration#rate-limits) per address and per network, and so is the current password asked for when changing it. Each attempt is counted before it is checked, so attempts sent at the same time can't get past the limit.
- Sessions are `HttpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS); the database stores only a hash of the session token.
- **Changes come from the app itself.** Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api` must come from the app's own pages: the browser's `Sec-Fetch-Site` header must say `same-origin` (or `none`, which browsers send only for something you did yourself, such as reloading), or, in browsers that don't send it, `Origin` must be `APP_URL`'s origin (a `CONTENT_ORIGIN` or any other host on the same site doesn't count). A request with neither header is refused. A request with a body type must send JSON (`application/json` or another `+json` type); one with no `Content-Type` at all, usually one without a body, is accepted. So another site can't sign you in to an account of its choosing or act with your session, even from a form. Requests with a bearer token (agents, access tokens, SCIM) aren't browser sessions and are exempt, and so is the SAML response an identity provider posts back.
- **After signing in, only this app.** Where to go next (`?next=`, SAML's `RelayState`) must be a path on `APP_URL`. Anything with a backslash or a control character, raw or percent-encoded, or that would resolve to another host, is dropped, and sign-in continues to the gallery.
- Google sign-in uses the authorization code flow with state and PKCE, and only accepts verified Google email addresses.
- **Sign-in doesn't say which accounts exist.** A wrong password gets the same answer for an address with an account, one without a password, and one with no account. Asking for a sign-in link answers the same for a suspended account as for any other; only using the link, from the mailbox, says the account is suspended. (Where sign-up is closed, asking for a link for an address with no account says so, because there is nothing to send.)
- [Single sign-on](/docs/sso) (Enterprise) uses OpenID Connect with PKCE, state and nonce, checks the ID token's signature against the provider's keys, and refuses any sign-in whose address the provider didn't verify, new accounts included, unless you chose to trust its addresses; so it links to an existing account only by a verified or trusted address. Client secrets are encrypted at rest. An instance admin can always sign in without it.

### Unverified accounts

On a server without email, an account made by signing up with a password, or from an invitation link passed on by hand, has an address nobody checked. Anyone could have typed someone else's address first. So:

- Pages shared with the address open for such an account only through the share's own link, and invitations to it don't show up in the app; see [Addresses nobody has checked](/docs/sharing#addresses-nobody-has-checked). Owners and admins can't [add such an account to an organization directly](/docs/organizations#adding-people-who-already-have-an-account) either; it gets an invitation.
- **Whoever proves the address takes the account over.** The first sign-in with an email link, an admin's sign-in link, Google or single sign-on marks the address as checked, and removes everything the account's earlier holder could get back in with: its password (an admin's link sets a new one), every session and pending sign-in, connected agents and access tokens, passkeys, the authenticator app and recovery codes, and the personal workspace's webhooks. Its pages, folders, comments and organizations stay. If this happens to your own account, set up your passkey or authenticator app again, reconnect your agents, and look through the account's pages and organizations for anything you don't recognize.
- Deleting such an account leaves pages shared with the address, and invitations to it, waiting for the address's real owner.

## Two-factor sign-in

An account with a passkey or an authenticator app has two-factor sign-in on (how to set it up: [Signing in](/docs/signing-in)). Every first factor ends the same way: a password, an email link (including one an instance admin made), Google and single sign-on each only make a pending sign-in, and the session starts once the second factor checks out.

- **Pending sign-ins** live in their own `HttpOnly`, `SameSite=Lax` cookie, scoped to `/api/auth` and stored as a hash, for at most 10 minutes. It isn't a session: with it you can only finish or abandon the sign-in. It is used up when the session starts, and deleted when the password changes, the account is suspended, or an admin resets its second factor.
- **An email link is one factor.** It proves you can read the mailbox, which is also what an attacker who got into it can do, so it never skips the second factor. The same goes for an admin's sign-in link on a server without email: it sets a new password, and the second factor is still asked for.
- **Wrong codes** (authenticator app and recovery codes) are limited to 10 per account per hour, whichever pending sign-in they come from; a right one clears the count. Each code is counted before it is checked, so codes sent at the same time can't get past the limit. Second-factor steps and passkey sign-ins are also limited per network. See `two-factor` and `two-factor-ip` under [Rate limits](/docs/configuration#rate-limits).
- **Changes need a fresh sign-in.** Adding or removing a passkey or the authenticator app, making new recovery codes, and adding a first password to an account that has none, need a session that signed in within the last hour, through the way the account signs in (an email link, Google, single sign-on or a passkey). Changing an existing password asks for the current one instead. Someone who gets hold of an older session can't give themselves a factor or a password that outlives it, or read new recovery codes. Setting a first password doesn't make the session any fresher than it was.

### Passkeys

Passkeys are WebAuthn credentials, checked with [SimpleWebAuthn](https://simplewebauthn.dev). The relying party is the install's own address: the RP ID is the host name of `APP_URL` and every response must come from its origin, so a passkey made for one install never works on another or on a look-alike domain. Changing the host name in `APP_URL` makes existing passkeys unusable; people sign in another way and add new ones.

- The server keeps only the public key, the credential id, the signature counter and whether the passkey is synced. No attestation is asked for, so any authenticator works.
- Every challenge is random, works once and for 5 minutes, and is bound to what it was made for (adding a passkey, signing in, or one person's second step). It is deleted as it is checked, so a response can't be replayed. A counter that goes backwards is refused.
- **Signing in with a passkey alone counts as both factors**, so it requires user verification: the authenticator must check a fingerprint, face or PIN, not just a touch. Passkeys the authenticator keeps as discoverable (most do) sign in without an email address being typed.
- As a second factor after a password, email link or Google, a touch is enough, and only the account's own passkeys are accepted.

### Authenticator apps

- Codes follow RFC 6238 with the settings every app supports: HMAC-SHA1, 6 digits, 30-second steps. A code is accepted for the step before and after the current one as well, for clocks that are a little off.
- A code is accepted once. The server records the last step it accepted in the same statement that checks it, so a code, or any older one, can't be used again, even by two requests at the same moment.
- The secret is 20 random bytes, encrypted at rest with AES-256-GCM under a key the server makes for itself on first use and keeps in the `server_secrets` table. A copy of the other tables, or a query log, doesn't reveal it. Without `ENCRYPTION_KEY`, a full database backup holds both; see [Keys in the database](#keys-in-the-database).
- It counts only once a first code from the app is confirmed.

### Recovery codes

Ten single-use codes, each 10 characters from an alphabet without look-alike characters (about 49 bits). They are shown once, when the first factor is added or when new ones are made, and stored only as SHA-256 hashes. Using one deletes it. Making new ones deletes the old ones; so does removing the last passkey and the authenticator app.

### Losing every factor

There is no self-service way around the second factor: that would be the way in for an attacker too. An instance admin can **Reset two-factor sign-in** for someone else under **Server admin**, **People**. It deletes their passkeys, authenticator app, recovery codes and pending sign-ins, signs them out everywhere, and writes a warning to the log with both account ids (`user.two_factor_reset` in [The security log](#the-security-log)). Admins can't do it for themselves (they use their own settings, or another admin). With a shell on the server, `reset-two-factor.js` does the same for any account, so the only admin isn't locked out for good (see [An existing install without an admin](/docs/self-hosting#an-existing-install-without-an-admin)). Organization owners and admins can't reset anyone's second factor.

### Organizations that require it

Owners and admins can turn on **Require two-factor sign-in** once they have a second factor themselves. Members without one are sent to set it up when they sign in, and until they do, they are treated as outside the organization everywhere:

- In the web app, its gallery, folders and settings answer that it requires two-factor sign-in, and they can't connect an agent to it or make access tokens for it. They can still leave it.
- Agents already connected to the organization and access tokens already made for it are refused, including refreshing an agent's token. They aren't deleted: they work again once the person adds a second factor.
- Agents and access tokens for their personal workspace or another organization can't open or change the organization's pages, and neither can links to page content made for them before (the sandboxed frame's link and an agent's download link), which are checked again on every use.
- Its pages open only if they are shared with them directly or by link. That includes pages they published there: owning one gives them nothing until they set up a second factor.

## Sessions

- A session lasts 30 days and is extended while it is used. **Account settings**, **Sessions** lists yours with the browser and system (from the `User-Agent` at sign-in; no IP addresses or locations are kept) and when each one signed in and was last active, which is updated at most every 5 minutes.
- **Sign out** ends one session and **Sign out other devices** ends every other one, at once. The list names sessions by a value derived from the stored hash, never the hash or the token.
- Changing your password ends every other session, and so does a password set with an admin's link. Suspension and an admin's two-factor reset end all of them.
- Changing your password leaves connected agents and access tokens working, since scripts and CI depend on them. Tick **Also disconnect agents and revoke access tokens** when you change it because someone else may have used your account.

## Agent access

- Agents connect with OAuth 2.1: dynamic client registration, authorization code with PKCE (S256), and your explicit approval on a consent screen.
- Redirects are limited to HTTPS, loopback addresses and app schemes.
- Access tokens last an hour; refresh tokens rotate on every use. A used refresh token is kept until it would have expired: if it is presented again, someone else has a copy, so every token of that connection is revoked and the agent has to connect again (OAuth 2.1 refresh token reuse detection). All tokens are stored as hashes.
- An agent acts for one person in one workspace, and only with that person's permissions. Disconnect it in **Account settings** to revoke it immediately.
- **What an agent reaches outside its workspace.** Being a page's owner, and a role in an organization (member, admin or owner), count only for pages in the agent's own workspace. Elsewhere it opens and changes only what is shared with the person directly (as viewer or editor) or by link, as a link someone sent them would. So an agent for your personal workspace can't open, change, share or delete an organization's pages, even if you are an admin of that organization or published them there, and an organization's owners always see every token that acts on its pages with those rights. The download links it gets from `download_artifact` carry its workspace, signed with the rest of the link, and are checked by the same rule each time they are used. It can still copy or move a page it may act on into another workspace you belong to, as publishing there would.
- Every request checks the agent's token against the database: it is refused for a suspended account, and for an organization the person is no longer in or that requires a second factor they haven't set up. Membership is also checked when an approval is exchanged for tokens and when a token is refreshed, and leaving or being removed from an organization deletes the agent's tokens and pending approvals for it.

## Access tokens

- [Access tokens](/docs/connect-your-agent#publishing-from-ci) for CI are made in **Account settings** by someone signed in to the app, never by another token, with a session that signed in within the last hour, so an older session someone got hold of can't be turned into a token that outlives it. Making them is [rate limited](/docs/configuration#rate-limits) per account.
- A token is `art_` followed by 32 random bytes in base64url, so secret scanners can recognize one that leaks. It is shown once; the server stores only its SHA-256 hash.
- It acts for one person in one workspace with that person's permissions, on `/mcp` and `POST /api/publish` only, by the same rule as an agent: outside its workspace, only pages shared with the person directly or by link (see [Agent access](#agent-access)). The app's cookie-authenticated routes ignore it.
- Every request checks the token against the database, with nothing cached: a revoked or expired token is refused on its next request. So is a token for an organization its owner is no longer in or that requires a second factor its owner hasn't set up, or of a suspended account. Leaving an organization, being removed from it, and suspension also delete the tokens they affect.
- Owners and admins of an organization can list and revoke every member's tokens for it. The list shows names and dates, never the token.

## Instance admins

- On a self-hosted install the first account becomes the instance admin. Creating it takes a one-time setup code the server prints to its log (or `SETUP_CODE`), so only someone who can read the server's log can claim a fresh install; the database keeps only a hash of the code. More admins can be added from the admin area, or from the server with the make-admin script. See [The instance admin](/docs/self-hosting#the-instance-admin).
- Admins manage accounts and organizations. They can't read private pages through the admin area: it shows counts, not page content.
- Suspending someone deletes their sessions, agent tokens and access tokens at once, and refuses their sign-in links, Google sign-in, passkeys and MCP calls until they are unsuspended. Links to page content made for them (the sandboxed frame's link and an agent's download link) are signed rather than stored, so they are checked against suspension each time they are used and stop working at once too.
- Everything admins do in the admin area is written to the server log; see [The security log](#the-security-log). There is no instance-level audit log in the app.
- The last admin can't be removed, suspended or deleted, so an install always keeps a way in. Changes to admins, and deleting accounts, happen one at a time and check again under a lock, so two admins demoting or deleting each other at the same moment still leave one. Deleting an account locks the owners of its organizations the same way leaving and changing roles do, so two owners deleting their accounts at once, or one deleting while the other leaves, can't leave an organization with people but no owner.

## The security log

Organizations have an [audit log](/docs/audit-log) on installs with an Enterprise license. Events that belong to no organization, or that remove one, are written to the server log instead, on every install, as one JSON line each (with Docker Compose, `docker compose logs app` shows it). Each line has an `event`, the account that did it (`actorId`, empty for scripts run on the server), what it was about (`targetId`), the request's `ip`, and the request id. Admin actions and deletions are warnings (`"level":"warn"`); people's own sign-in changes are information.

| `event` | When |
| --- | --- |
| `admin.granted`, `admin.revoked` | An admin makes someone an admin or removes it, or `make-admin.js` runs on the server |
| `user.suspended`, `user.reactivated`, `user.deleted` | An admin suspends, reactivates or deletes someone |
| `user.two_factor_reset` | An admin, or `reset-two-factor.js` on the server, resets someone's two-factor sign-in |
| `user.sign_in_link_created` | An admin makes a sign-in link on a server without email. For an existing account (`newAccount: false`) the link sets a new password, so treat it like a password reset |
| `organization.deleted` | An admin deletes an organization, or it goes with the account of its only member. Its audit log goes with it, so this line is what is left |
| `instance.settings_changed` | An admin changes the sign-up policy, its domains, the instance name, or the organization and domains of [joining by email domain](/docs/self-hosting#joining-an-organization-by-email-domain), with what changed |
| `license.changed`, `license.removed` | An admin enters or removes the license key |
| `scim_token.created`, `scim_token.revoked` | An admin creates or revokes a [SCIM](/docs/scim) token |
| `sso_connection.added`, `sso_connection.changed`, `sso_connection.removed` | An admin changes a [single sign-on](/docs/sso) provider, with its domains and whether it is on and required. Never its secret |
| `sso.link_refused` | Single sign-on refused to sign in to an existing account it isn't linked to yet (see [How it works](/docs/sso#how-it-works)) |
| `account.deleted` | Someone deletes their own account |
| `account.password_changed`, `account.password_added` | Someone changes or adds their password, or a sign-in link sets it |
| `account.passkey_added`, `account.passkey_removed`, `account.authenticator_added`, `account.authenticator_removed`, `account.recovery_codes_created` | Someone changes their two-factor sign-in |
| `account.sessions_revoked` | Someone signs out their other sessions |
| `access_token.created`, `access_token.revoked` | An access token is made or revoked, personal ones included |

The log holds account ids rather than names, except the address a sign-in link was made for. Keep it as long as you need this record, for example by sending it to a log collector; the server itself doesn't keep it.

## Page views

Opening a page is counted, and for pages shared with specific people or an organization, the server records who opened it and when. That record is deleted after 90 days, and only people who can edit the page see it. Visits through a link shared with **Anyone with the link** are counted without recording who made them or their address. See [Who opened a page](/docs/sharing#who-opened-a-page).

## Keys in the database

The server keeps the keys it makes for itself in the `server_secrets` table: the ones that encrypt authenticator app, webhook and single sign-on secrets, and the ones that sign links to page content and data exports. Without `ENCRYPTION_KEY`, they are stored as they are, so one copy of the database, such as a leaked backup or dump, is enough to read every authenticator app secret (and sign in past the second factor), every webhook and single sign-on secret, and to make links that open any private page.

With `ENCRYPTION_KEY` set, those rows are stored encrypted with AES-256-GCM under a key derived from it (HKDF-SHA256), each bound to its row's name. The key lives only in the server's settings, so a copy of the database or its backups alone opens none of them. A server that starts with encrypted rows and without the right key stops with an error instead of making new keys. Set it on every server reachable from the internet, and keep it apart from database backups; see [Encryption key](/docs/configuration#encryption-key).

## Self-hosted data

Everything lives in your own Postgres database and object storage: accounts and version history in Postgres, page HTML, files and thumbnails in the bucket. Nothing is sent to us, and the app's own fonts and scripts are served by your server rather than a CDN. The bucket should stay private; pages are only ever served through the app, which checks access and adds the sandbox headers. While rendering thumbnails, the server may fetch scripts and fonts that pages load from the public CDNs listed above; set `THUMBNAIL_CDN_HOSTS=none` to turn that off. [Webhooks](/docs/webhooks) send events to the addresses your workspace admins add, and nowhere else.

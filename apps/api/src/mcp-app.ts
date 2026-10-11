import { artifactUrl, canView, findBySlug, parseArtifactRef, type Viewer } from './artifacts.js'
import { signContentLink } from './content.js'
import { env } from './env.js'
import { escapeHtml, SITE } from './previews.js'

// The MCP Apps viewer: what a client that supports the MCP Apps extension (SEP-1865,
// io.modelcontextprotocol/ui) shows under a tool call that published a page, instead of a link.
//
// The app's viewer at /a/<id> can't be framed by other sites (SHELL_HEADERS, docs/security.md), and
// embeds (/e/<id>) show only pages shared with anyone who has the link. An MCP app runs with the
// person's own authorization: the host reads resources through the same connection the agent uses,
// so the viewer can ask for a content link signed for that person (artifact://<id>/view) and frame
// the page's files under it, whatever its visibility. The link names the person and expires
// (content.ts), and is asked for again on every render, so a page's history in a chat stays viewable
// without a token ever being stored in it.
//
// The viewer is one HTML document with no dependencies, served as the resource ui://the-artifact/viewer
// with the MCP Apps MIME type; it speaks the extension's JSON-RPC over postMessage itself (initialize,
// the tool-result notification, resources/read and ui/open-link), which is small enough that pulling
// a client library into the API isn't worth a build step.

export const VIEWER_URI = 'ui://the-artifact/viewer'
export const VIEWER_MIME = 'text/html;profile=mcp-app'
export const VIEW_URI_TEMPLATE = 'artifact://{id}/view'
export const APPS_PROTOCOL_VERSION = '2026-01-26'

export const VIEW_URI_RE = /^artifact:\/\/([^/]+)\/view$/

// Tools whose answer is a page get the viewer attached (_meta.ui.resourceUri)
export const VIEWER_TOOL_META = { ui: { resourceUri: VIEWER_URI } }

// The viewer frames the page's files, which the app's host or the content origin serves; the host's
// CSP for the app only lets those origins be framed
export function viewerResourceMeta() {
  const frameDomains = [new URL(env.appUrl).origin]
  if (env.contentOrigin) frameDomains.push(env.contentOrigin)
  return { ui: { csp: { frameDomains }, prefersBorder: true } }
}

export type ViewData = {
  id: string
  title: string
  version: number
  visibility: 'private' | 'organization' | 'link'
  // The page's files under a link signed for the person, which a frame can load without cookies
  url: string
  // The page in the app, for a link out
  open: string
}

// The current version of a page the person can open, under a content link signed for them, or null
export async function viewData(viewer: Viewer, ref: string): Promise<ViewData | null> {
  const artifact = await findBySlug(parseArtifactRef(ref))
  if (!artifact || !(await canView(artifact, viewer))) return null
  const version = artifact.currentVersion
  const token = await signContentLink(viewer.id, artifact, version, Date.now(), viewer.workspace)
  return {
    id: artifact.slug,
    title: artifact.title,
    version,
    visibility: artifact.visibility,
    url: `${env.contentOrigin ?? env.appUrl}/api/artifacts/${artifact.slug}/v/${version}/~${token}/`,
    open: artifactUrl(artifact.slug),
  }
}

// Same as the embed's frame (embeds.ts): the page keeps its sandbox, with the host's own sandbox on top
const FRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
// Height the viewer asks the host for; hosts cap it at what fits their layout
const HEIGHT = 520

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;font:var(--font-text-sm-size,13px)/1.4 var(--font-sans,'Schibsted Grotesk',ui-sans-serif,system-ui,sans-serif);color:var(--color-text-primary,#1c2b4b);background:var(--color-background-primary,#fafbfd)}
.bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--color-border-primary,#dde4ef)}
.title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:var(--font-weight-medium,500)}
.meta{color:var(--color-text-secondary,#4a587a)}
button{font:inherit;color:var(--color-text-primary,#1c2b4b);background:none;border:1px solid var(--color-border-primary,#dde4ef);border-radius:var(--border-radius-sm,4px);padding:3px 8px;cursor:pointer}
button:hover,button:focus-visible{border-color:var(--color-text-secondary,#4a587a)}
.page{flex:1;width:100%;border:0;background:#fff}
.card{margin:auto;padding:24px;max-width:360px;text-align:center}
.card p{margin:0 0 12px;color:var(--color-text-secondary,#4a587a);white-space:pre-wrap}
[hidden]{display:none !important}
`

// Runs inside the host's sandboxed frame. Talks the MCP Apps extension to window.parent; the host's
// sandbox proxy relays to the host. Nothing here trusts the page it frames.
const SCRIPT = `
'use strict'
var PROTOCOL = ${JSON.stringify(APPS_PROTOCOL_VERSION)}
var SITE = ${JSON.stringify(SITE)}
var HEIGHT = ${HEIGHT}
var nextId = 1
var pending = new Map()
var ready = false
var queued = null

function send(message) { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, message), '*') }
function request(method, params) {
  return new Promise(function (resolve, reject) {
    var id = nextId++
    pending.set(id, { resolve: resolve, reject: reject })
    send({ id: id, method: method, params: params })
  })
}
function notify(method, params) { send({ method: method, params: params }) }

window.addEventListener('message', function (event) {
  var m = event.data
  if (!m || m.jsonrpc !== '2.0') return
  if (m.id !== undefined && m.method === undefined) {
    var p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error.message || 'Request failed'))
    else p.resolve(m.result)
    return
  }
  if (m.method === 'ping') { send({ id: m.id, result: {} }); return }
  if (m.method === 'ui/notifications/tool-result') { onResult(m.params); return }
  if (m.method === 'ui/notifications/host-context-changed') { applyContext(m.params); return }
  if (m.method === 'ui/resource-teardown') { send({ id: m.id, result: {} }); return }
  if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'Method not found' } })
})

var $ = function (id) { return document.getElementById(id) }

function applyContext(context) {
  if (!context) return
  if (context.theme) {
    document.documentElement.setAttribute('data-theme', context.theme)
    document.documentElement.style.colorScheme = context.theme
  }
  var variables = context.styles && context.styles.variables
  if (variables) for (var key in variables) if (variables[key] !== undefined) document.documentElement.style.setProperty(key, variables[key])
}

function show(message) {
  $('frame').hidden = true
  $('bar').hidden = true
  $('card').hidden = false
  $('message').textContent = message
}

function slugOf(result) {
  var sc = result && result.structuredContent
  if (sc && typeof sc.id === 'string') return sc.id
  var text = ((result && result.content) || []).map(function (c) { return c.type === 'text' ? c.text : '' }).join('\\n')
  var match = text.match(/artifact_id: ([a-z0-9]+)/)
  return match ? match[1] : null
}

function textOf(result) {
  return ((result && result.content) || []).map(function (c) { return c.type === 'text' ? c.text : '' }).join('\\n').trim()
}

async function onResult(result) {
  if (!ready) { queued = result; return }
  var slug = slugOf(result)
  if (!slug || (result && result.isError)) { show(textOf(result) || 'Nothing to show.'); return }
  var view
  try {
    var read = await request('resources/read', { uri: 'artifact://' + slug + '/view' })
    var content = read && read.contents && read.contents[0]
    view = content && content.text ? JSON.parse(content.text) : null
  } catch (error) {
    show('This page could not be opened: ' + (error && error.message ? error.message : error))
    return
  }
  if (view && view.error) { show(view.error); return }
  if (!view || !view.url) { show('No page you can open has the id "' + slug + '".'); return }
  $('card').hidden = true
  $('bar').hidden = false
  $('title').textContent = view.title
  $('title').title = view.title
  $('version').textContent = 'v' + view.version
  var open = $('open')
  open.hidden = false
  open.onclick = function () { request('ui/open-link', { url: view.open }).catch(function () {}) }
  var frame = $('frame')
  frame.title = view.title
  frame.hidden = false
  frame.src = view.url
  notify('ui/notifications/size-changed', { height: HEIGHT })
}

async function start() {
  try {
    var init = await request('ui/initialize', { appInfo: { name: 'the-artifact-viewer', version: '1' }, appCapabilities: {}, protocolVersion: PROTOCOL })
    applyContext(init && init.hostContext)
  } catch (error) {
    show('This host could not open the viewer: ' + (error && error.message ? error.message : error))
    return
  }
  notify('ui/notifications/initialized', {})
  ready = true
  if (queued) { var result = queued; queued = null; onResult(result) }
}
start()
`

export function viewerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(SITE)}</title>
<style>${STYLE}</style>
</head>
<body>
<div id="bar" class="bar" hidden>
<span id="title" class="title"></span>
<span id="version" class="meta"></span>
<button id="open" type="button" hidden>Open in ${escapeHtml(SITE)}</button>
</div>
<iframe id="frame" class="page" sandbox="${FRAME_SANDBOX}" allow="fullscreen" referrerpolicy="no-referrer" hidden></iframe>
<div id="card" class="card"><p id="message">Loading…</p></div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

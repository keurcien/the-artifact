import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { verifyContentLink } from '../../src/content.js'
import { db, schema } from '../../src/db/index.js'
import { env } from '../../src/env.js'
import { VIEWER_URI } from '../../src/mcp-app.js'
import { call, callTool, connectAgent, createUser, mcpRequest, slugFrom } from './helpers.js'

const HTML = '<!doctype html><title>Chart</title><h1>Signups by week</h1>'
const VIEWER_TOOLS = ['publish_artifact', 'update_files', 'publish_upload', 'duplicate_artifact', 'restore_version']

async function setup() {
  const user = await createUser({ email: 'dev@example.com', name: 'Dev Person' })
  const { access_token } = await connectAgent(user)
  return { user, token: access_token }
}

async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await mcpRequest(token, method, params)
  expect(res.status).toBe(200)
  return (await res.json()) as { result?: Record<string, never>; error?: { message: string } }
}

type View = { id: string; url: string; open: string; title: string; version: number; visibility: string }

async function readView(token: string, slug: string): Promise<Partial<View> & { error?: string }> {
  const body = await rpc(token, 'resources/read', { uri: `artifact://${slug}/view` })
  if (!body.result) return { error: body.error?.message ?? 'failed' }
  const [content] = body.result.contents as { uri: string; mimeType: string; text: string }[]
  return JSON.parse(content.text) as View
}

describe('MCP Apps viewer', () => {
  it('attaches the viewer to the tools that answer with a page', async () => {
    const { token } = await setup()
    const { result } = await rpc(token, 'tools/list')
    const tools = result!.tools as { name: string; _meta?: { ui?: { resourceUri?: string } } }[]
    const withViewer = tools.filter((t) => t._meta?.ui?.resourceUri === VIEWER_URI).map((t) => t.name)
    expect(withViewer.sort()).toEqual([...VIEWER_TOOLS].sort())
  })

  it('lists and serves the viewer as an MCP App resource that may frame this server', async () => {
    const { token } = await setup()
    const listed = (await rpc(token, 'resources/list')).result!.resources as { uri: string; mimeType: string; _meta?: Record<string, unknown> }[]
    const viewer = listed.find((r) => r.uri === VIEWER_URI)
    expect(viewer).toMatchObject({ mimeType: 'text/html;profile=mcp-app', _meta: { ui: { csp: { frameDomains: [new URL(env.appUrl).origin] } } } })

    const templates = (await rpc(token, 'resources/templates/list')).result!.resourceTemplates as { uriTemplate: string }[]
    expect(templates.map((t) => t.uriTemplate)).toContain('artifact://{id}/view')

    const read = (await rpc(token, 'resources/read', { uri: VIEWER_URI })).result!.contents as { mimeType: string; text: string }[]
    expect(read[0].mimeType).toBe('text/html;profile=mcp-app')
    expect(read[0].text).toContain('<!doctype html>')
    expect(read[0].text).toContain("'ui/initialize'")
    expect(read[0].text).toContain('ui/notifications/tool-result')
    expect(read[0].text).toContain('sandbox="allow-scripts')
  })

  it('answers the publish tools with the page as structured content', async () => {
    const { token } = await setup()
    const first = (await rpc(token, 'tools/call', { name: 'publish_artifact', arguments: { title: 'Signups', html: HTML } })).result!
    const slug = slugFrom((first.content as { text: string }[])[0].text)
    expect(first.structuredContent).toMatchObject({
      id: slug,
      url: `${env.appUrl}/a/${slug}`,
      title: 'Signups',
      version: 1,
      visibility: 'private',
      folder: null,
    })

    await callTool(token, 'publish_artifact', { title: 'Signups v2', html: '<h1>v2</h1>', artifact_id: slug })
    const restored = (await rpc(token, 'tools/call', { name: 'restore_version', arguments: { artifact_id: slug, version: 1 } })).result!
    expect(restored.structuredContent).toMatchObject({ id: slug, version: 3 })

    const copied = (await rpc(token, 'tools/call', { name: 'duplicate_artifact', arguments: { artifact_id: slug } })).result!
    const copy = copied.structuredContent as { id: string; title: string }
    expect(copy.id).not.toBe(slug)
    expect(copy.title).toBe('Signups v2 (copy)')

    const changed = (
      await rpc(token, 'tools/call', { name: 'update_files', arguments: { artifact_id: slug, files: [{ path: 'style.css', content: 'h1{}' }] } })
    ).result!
    expect(changed.structuredContent).toMatchObject({ id: slug, version: 4 })
  })

  it('gives the person a signed link to a restricted page, which a frame loads without cookies', async () => {
    const { user, token } = await setup()
    const published = await callTool(token, 'publish_artifact', { title: 'Signups', html: HTML })
    const slug = slugFrom(published.text)

    const view = await readView(token, slug)
    expect(view).toMatchObject({ id: slug, title: 'Signups', version: 1, visibility: 'private', open: `${env.appUrl}/a/${slug}` })
    const url = new URL(view.url!)
    expect(url.origin).toBe(new URL(env.appUrl).origin)
    const token1 = url.pathname.match(new RegExp(`^/api/artifacts/${slug}/v/1/~([^/]+)/$`))?.[1]
    expect(token1).toBeTruthy()

    // Signed for this person, for this version
    const [artifact] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.slug, slug))
    expect(await verifyContentLink(token1!, artifact, 1)).toMatchObject({ userId: user.id })

    // The page itself, under the link, with no session: what the viewer's frame does
    const page = await call(url.pathname, { headers: { 'sec-fetch-dest': 'iframe' } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Signups by week')
    expect(page.headers.get('content-security-policy')).toMatch(/^sandbox /)

    // Without the token the restricted page is not served
    expect((await call(`/api/artifacts/${slug}/v/1/`)).status).toBe(404)
  })

  it('follows the current version', async () => {
    const { token } = await setup()
    const slug = slugFrom((await callTool(token, 'publish_artifact', { title: 'Signups', html: HTML })).text)
    await callTool(token, 'publish_artifact', { title: 'Signups', html: '<h1>v2</h1>', artifact_id: slug })
    const view = await readView(token, slug)
    expect(view.version).toBe(2)
    expect(view.url).toContain(`/v/2/~`)
  })

  it("refuses a page the person can't open, and an unknown id", async () => {
    const { token } = await setup()
    const slug = slugFrom((await callTool(token, 'publish_artifact', { title: 'Signups', html: HTML })).text)
    const other = await createUser({ email: 'other@example.com' })
    const { access_token } = await connectAgent(other)
    expect(await readView(access_token, slug)).toMatchObject({ error: expect.stringContaining('No page you can open') })
    expect(await readView(token, 'nosuchpage')).toMatchObject({ error: expect.stringContaining('No page you can open') })
  })
})

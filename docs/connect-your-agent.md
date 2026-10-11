# Connect your agent

The Artifact is an MCP server that speaks streamable HTTP at:

```
{{MCP_URL}}
```

Add it once. The first time the agent connects, it opens your browser: sign in, pick the workspace the agent should publish to, and choose **Allow**.

Use this address exactly as shown. The sign-in your agent gets is tied to it.

## Which agents work

Any agent that supports remote MCP servers over HTTP can connect. It signs in one of two ways:

- **Browser sign-in (OAuth).** The agent finds the sign-in server on its own and opens your browser. Nothing to copy.
- **Access token.** You make an [access token](#publishing-from-ci) and give it to the agent as an `Authorization: Bearer` header. Use this where no browser can open, or for an agent that can't do the browser sign-in.

| Agent | How it connects | Sign-in | Tested |
| --- | --- | --- | --- |
| [Claude Code](#claude-code) | Streamable HTTP | Browser or access token | Yes, 2026-09-28 |
| [Claude Desktop and Claude.ai](#claude-desktop-and-claude-on-the-web) | Custom connector, through Anthropic's servers | Browser | Not yet |
| [Claude Desktop, local bridge](#claude-desktop-with-mcp-remote) | `mcp-remote` on your computer | Browser or access token | Not yet |
| [Cursor](#cursor) | Streamable HTTP | Browser or access token | Not yet |
| [VS Code (GitHub Copilot agent mode)](#vs-code-github-copilot) | HTTP (`"type": "http"`) | Browser or access token | Not yet |
| [OpenAI Codex (CLI and IDE extension)](#openai-codex) | Streamable HTTP | Browser (`codex mcp login`) or access token | Not yet |
| [Windsurf (Devin Desktop)](#windsurf-devin-desktop) | Streamable HTTP (`serverUrl`) | Browser or access token | Not yet |

An agent that supports [MCP Apps](https://modelcontextprotocol.io/extensions/apps) also shows each page it publishes right under the tool call, with your own access to it; see [Pages in the chat](/docs/publishing#pages-in-the-chat). The others show the link.

**Tested** means someone connected that agent and published a page with it on the date shown. **Not yet** means the setup follows the agent's own documentation as of 2026-09-28, but nobody has published a page with it yet. If a step here is wrong for your version, the agent's own MCP documentation wins.

## Claude Code

**Tested** on 2026-09-28 with Claude Code 2.1.283: browser sign-in and access token, publishing a page, a new version of it, `list_versions`, `list_artifacts`, `get_artifact`, and a two-file page with `prepare_upload` and `publish_upload`.

```sh
claude mcp add --transport http --scope user the-artifact {{MCP_URL}}
```

`--scope user` makes it available in every project. Then run `/mcp` inside Claude Code, pick `the-artifact` and choose **Authenticate**. You can also sign in from the shell:

```sh
claude mcp login the-artifact
```

On a machine without a browser, such as over SSH, add `--no-browser`. Claude Code prints the sign-in address; open it on any computer, and when your browser lands on a `localhost` address that doesn't load, paste that whole address back into the terminal.

`claude mcp list` shows `✔ Connected` once it works, or `Needs authentication` until you sign in.

To use an access token instead of the browser sign-in:

```sh
claude mcp add --transport http --scope user the-artifact {{MCP_URL}} --header "Authorization: Bearer $ARTIFACT_TOKEN"
```

## Claude Desktop and Claude on the web

**Not yet tested.**

Claude Desktop and Claude.ai (the website) connect to remote MCP servers as custom connectors. You add a connector once to your Claude account and it works in both.

1. On a Free, Pro or Max plan, open **Customize → Connectors**, choose **+** and then **Add custom connector**. On a Team or Enterprise plan, an owner adds it under **Organization settings → Connectors**: **Add**, then **Custom**, then **Web**.
2. Enter `{{MCP_URL}}` as the URL. Leave **Advanced settings** empty; the agent registers itself.
3. Choose **Add**, then **Connect**, and sign in in the browser window that opens.

Anthropic's servers make the connection, not your computer. The server has to be reachable from the internet over HTTPS. The hosted service is; a self-hosted server on `localhost` or a private network is not. For that, use the bridge below.

### Claude Desktop with mcp-remote

**Not yet tested.**

`mcp-remote` runs on your computer and passes Claude Desktop's requests on to the server, so it reaches servers on your own network. It needs Node.js. In Claude Desktop, open **Settings → Developer → Edit Config** and add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "the-artifact": {
      "command": "npx",
      "args": ["mcp-remote", "{{MCP_URL}}"]
    }
  }
}
```

Restart Claude Desktop. `mcp-remote` opens your browser to sign in. If the address starts with `http://` and isn't `localhost`, add `"--allow-http"` to `args`, and only on a network you trust.

To use an access token, pass it as a header. Keep the space out of the argument and put it in the value, as `mcp-remote` asks:

```json
{
  "mcpServers": {
    "the-artifact": {
      "command": "npx",
      "args": ["mcp-remote", "{{MCP_URL}}", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer art_your_token" }
    }
  }
}
```

## Cursor

**Not yet tested.**

Add this to `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` for one:

```json
{
  "mcpServers": {
    "the-artifact": {
      "url": "{{MCP_URL}}"
    }
  }
}
```

Cursor asks you to sign in when it first connects. To use an access token instead, add a header. `${env:ARTIFACT_TOKEN}` reads the token from your environment, so it stays out of the file:

```json
{
  "mcpServers": {
    "the-artifact": {
      "url": "{{MCP_URL}}",
      "headers": {
        "Authorization": "Bearer ${env:ARTIFACT_TOKEN}"
      }
    }
  }
}
```

## VS Code (GitHub Copilot)

**Not yet tested.**

GitHub Copilot uses MCP tools in agent mode. Run **MCP: Add Server** from the Command Palette and choose **HTTP**, or add this to `.vscode/mcp.json` in a project. For every project, run **MCP: Open User Configuration** and add it there.

```json
{
  "servers": {
    "the-artifact": {
      "type": "http",
      "url": "{{MCP_URL}}"
    }
  }
}
```

VS Code registers itself and asks you to sign in the first time it connects. **MCP: List Servers** shows the server and lets you start, stop or restart it. In the Chat view, pick **Agent** and ask for a page.

To use an access token, let VS Code ask for it once and keep it out of the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "artifact-token",
      "description": "The Artifact access token",
      "password": true
    }
  ],
  "servers": {
    "the-artifact": {
      "type": "http",
      "url": "{{MCP_URL}}",
      "headers": {
        "Authorization": "Bearer ${input:artifact-token}"
      }
    }
  }
}
```

## OpenAI Codex

**Not yet tested.**

The Codex CLI and the Codex IDE extension read the same file, so setting it up once covers both. Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.the-artifact]
url = "{{MCP_URL}}"
```

Or add it from the shell:

```sh
codex mcp add the-artifact --url {{MCP_URL}}
```

Then sign in and restart Codex:

```sh
codex mcp login the-artifact
```

To use an access token instead, name the environment variable that holds it. Codex sends it as a bearer token:

```toml
[mcp_servers.the-artifact]
url = "{{MCP_URL}}"
bearer_token_env_var = "ARTIFACT_TOKEN"
```

## Windsurf (Devin Desktop)

**Not yet tested.**

Windsurf is now called Devin Desktop; its MCP setup is the same. In the Cascade panel, choose **…** at the top right, then **Open MCP config file**, and add:

```json
{
  "mcpServers": {
    "the-artifact": {
      "serverUrl": "{{MCP_URL}}"
    }
  }
}
```

The file is `~/.config/devin/mcp_config.json` on macOS and Linux and `%APPDATA%\devin\mcp_config.json` on Windows. Older Windsurf versions keep it in `~/.codeium/windsurf/mcp_config.json`. Note the key is `serverUrl`, not `url`. Devin Desktop asks you to sign in when it connects.

To use an access token, add a header that reads it from your environment:

```json
{
  "mcpServers": {
    "the-artifact": {
      "serverUrl": "{{MCP_URL}}",
      "headers": {
        "Authorization": "Bearer ${env:ARTIFACT_TOKEN}"
      }
    }
  }
}
```

## Other MCP clients

Any client that supports MCP over streamable HTTP with OAuth can connect with the URL above. What it needs:

| Step | What the server offers |
| --- | --- |
| Finding the sign-in server | A `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, pointing at `/.well-known/oauth-protected-resource/mcp`, which names `{{APP_URL}}` as the authorization server |
| Its settings | `/.well-known/oauth-authorization-server` |
| Registering | Dynamic client registration at `/oauth/register`, as a public client with no secret. Redirect addresses can be `https`, `http` on `localhost` or `127.0.0.1`, or an app's own scheme such as `cursor://` |
| Signing in | Authorization code flow with PKCE (`S256` only), scope `artifacts` |
| Staying signed in | Refresh tokens, which change each time they are used |

A client that can't do this can send an [access token](#publishing-from-ci) as an `Authorization: Bearer` header, or run through `mcp-remote` as in [Claude Desktop with mcp-remote](#claude-desktop-with-mcp-remote).

## Choosing a workspace

A connection publishes to one workspace: your personal workspace or one of your organizations. To publish somewhere else, disconnect the agent in **Account settings → Connected agents** and connect it again.

The workspace also limits what the agent can do to pages you already have:

- **In its workspace**, it has your permissions: it edits, shares and deletes the pages you own there, and in an organization everything your role allows (owners and admins edit every page, members open pages shared with the organization).
- **Elsewhere**, it has only what is shared with you directly (as a viewer or editor) or by link, as if someone had sent you the link. Owning a page or being an admin in another organization doesn't count. An agent for your personal workspace can't open or change an organization's pages, and an agent for an organization can't open or change your personal pages, unless they are shared that way.

To work on pages in another workspace, connect a second agent to it. [Access tokens](#publishing-from-ci) follow the same rule.

## Disconnecting

**Account settings → Connected agents** lists every agent with access, the workspace it publishes to, and when it was last used. **Disconnect** revokes its access at once; the agent has to sign in again to publish.

An agent is also disconnected when it leaves an organization's workspace (you leave or are removed), when your account is suspended, and when one of its refresh tokens is used a second time, which happens when a copy of the token is used somewhere else. Connect it again to go on. The [command line](/docs/publishing#command-line) shows there as **The Artifact CLI**, and `the-artifact logout` disconnects it too.

## Publishing from CI

A CI job (a test report, a nightly dashboard) can't open a browser to sign in. Give it an access token instead.

1. Open **Account settings → Access tokens**, enter a name, pick the workspace it publishes to and when it expires (7, 30 or 90 days, 1 year, or no expiry; 90 days unless you choose), and choose **Create token**. It needs a sign-in from the last hour; if yours is older, choose **Sign in again** first.
2. Copy the token. It starts with `art_` and is shown once; only a hash of it is stored.
3. Save it as a secret where the job runs, e.g. a GitHub Actions secret named `ARTIFACT_TOKEN`.

A token acts for you in that one workspace, with your permissions, like a connected agent: outside it, it reaches only pages shared with you directly or by link (see [Choosing a workspace](#choosing-a-workspace)). It works as a bearer token for `POST /api/publish` (see [Publishing without an agent](/docs/publishing#publishing-without-an-agent)) and for every MCP tool at `{{MCP_URL}}`. It can't sign in to the app or make other tokens.

**Account settings → Access tokens** lists your tokens with their workspace, when they were made and last used, and when they expire. **Revoke** stops a token at once: the next request with it is refused. A token also stops working when it expires, when you leave the organization it is for, or when your account is suspended, and while the organization [requires two-factor sign-in](/docs/organizations#requiring-two-factor-sign-in) and you haven't set it up. Owners and admins of an organization can see and revoke its members' tokens for it (see [Organizations](/docs/organizations#access-tokens)).

### GitHub Actions

This workflow publishes a report the tests write to `report/` (an `index.html` and the files it loads) after every push to `main`, as a new version of the same page each time. The first run creates the page and prints its `id`; save it as the repository variable `REPORT_PAGE_ID` so later runs update that page and its link stays the same.

```yaml
name: Test report
on:
  push:
    branches: [main]

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm test
      - name: Publish the report
        if: always()
        env:
          ARTIFACT_TOKEN: ${{ secrets.ARTIFACT_TOKEN }}
          PAGE_ID: ${{ vars.REPORT_PAGE_ID }}
        run: |
          cd report
          args=(-F "title=Test report for ${GITHUB_SHA::7}")
          if [ -n "$PAGE_ID" ]; then args+=(-F "artifact_id=$PAGE_ID"); fi
          while IFS= read -r f; do args+=(-F "$f=@$f"); done < <(find . -type f | sed 's|^\./||')
          curl -fsS {{APP_URL}}/api/publish -H "Authorization: Bearer $ARTIFACT_TOKEN" "${args[@]}"
```

Each file of the folder goes up as a form part named by its path, with `index.html` as the page itself. Only [the file types pages allow](/docs/publishing#publish_artifact) are accepted. The answer is JSON with the page's `id` and `url`.

The [command line](/docs/publishing#command-line) does the same in one step. It leaves out hidden files and types pages can't hold, and prints only the link:

```yaml
      - name: Publish the report
        if: always()
        env:
          THE_ARTIFACT_URL: {{APP_URL}}
          THE_ARTIFACT_TOKEN: ${{ secrets.ARTIFACT_TOKEN }}
        run: npx @the-artifact/cli publish report --title "Test report for ${GITHUB_SHA::7}" --id "${{ vars.REPORT_PAGE_ID }}"
```

For a single HTML file, send JSON:

```sh
jq -n --rawfile html dashboard.html '{title: "Nightly dashboard", html: $html}' |
  curl -fsS {{APP_URL}}/api/publish -H "Authorization: Bearer $ARTIFACT_TOKEN" -H 'Content-Type: application/json' --data-binary @-
```

A job that runs an agent can give it the token instead of signing in, as an `Authorization` header on the MCP server. For Claude Code:

```sh
claude mcp add --transport http the-artifact {{MCP_URL}} --header "Authorization: Bearer $ARTIFACT_TOKEN"
```

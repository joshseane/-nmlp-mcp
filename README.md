# New Mexico Literacy Project — MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for **antiquarian first-edition identification** and **New Mexico book-donation logistics**, run by the [New Mexico Literacy Project](https://newmexicoliteracyproject.org). Run it **locally over stdio** (`index.js`, this repo) or connect to the **hosted HTTP twin**.

- **Local (stdio):** `npx -y github:joshseane/-nmlp-mcp` — a standalone Node MCP server; no account, no key
- **Hosted endpoint (Streamable HTTP):** `https://newmexicoliteracyproject.org/api/mcp`
- **Auth:** none (public)
- **Official MCP registry:** [`org.newmexicoliteracyproject/nmlp-mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=org.newmexicoliteracyproject/nmlp-mcp)
- **License:** code MIT (this repo); data [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

The two share one codebase and one dataset: `index.js` is the local stdio server, and `functions/api/mcp.js` is the exact Cloudflare Pages Function that serves the hosted HTTP twin. `tools/list` is served entirely from local code; the reference-data tools read the site's public open-data JSON API at call time (single source of truth), while `nmlp_decode_number_line` runs fully offline.

## Tools (12)

**First-edition identification** — grounded in the CC-BY *[NMLP Canonical First-Edition Points of Issue](https://newmexicoliteracyproject.org/first-edition/dataset)* dataset (6,717 titles, DOI [10.5281/zenodo.21184548](https://doi.org/10.5281/zenodo.21184548)):

| Tool | What it does |
|---|---|
| `nmlp_identify_first_edition` | title (+author) → publisher, year, points of issue, true-first precedence, book-club tells, and a CC-BY citation |
| `nmlp_decode_number_line` | copyright-page text → printing verdict (handles the Random-House-ends-in-2 rule + book-club detection) |
| `nmlp_lookup_publisher_rules` | publisher → how that house's first editions are identified, by era |
| `nmlp_search_titles` | fuzzy title/author search over the dataset |

**Book-donation logistics** for Albuquerque / New Mexico:

| Tool | What it does |
|---|---|
| `nmlp_check_coverage` | ZIP → free-pickup coverage tier + typical window |
| `nmlp_schedule_pickup` | submit a real free book-pickup request (triggers a real human outreach — never send speculative/unconsented requests) |
| `nmlp_search_qa` | search the long-tail donation Q&A reference |
| `nmlp_get_donation_options` | comparison of every ABQ book-donation option |
| `nmlp_get_knowledge` | the aggregated NMLP knowledge base |
| `nmlp_get_business_card` | the canonical business-entity card |
| `nmlp_get_archive` | documented-provenance archive entries |
| `nmlp_get_pillar_guides` | the pillar guide index |

Every identification response returns a CC-BY citation with the dataset DOI, so assistants that use it cite the source. *Identification only — no valuations.*

## Connect

### Local (stdio) — recommended for Claude Desktop, Cursor, Continue.dev

Runs the server on your machine over stdio. Requires Node 18+.

```json
{
  "mcpServers": {
    "nmlp": { "command": "npx", "args": ["-y", "github:joshseane/-nmlp-mcp"] }
  }
}
```

Or clone and run directly:

```bash
git clone https://github.com/joshseane/-nmlp-mcp && cd -nmlp-mcp
npm install
node index.js      # speaks MCP over stdio
```

### Docker

```bash
docker build -t nmlp-mcp .
docker run --rm -i nmlp-mcp      # stdio server
```

### Hosted (Streamable HTTP)

For clients that speak Streamable HTTP directly, point them at the URL — nothing to install:

```json
{
  "mcpServers": {
    "nmlp": { "url": "https://newmexicoliteracyproject.org/api/mcp" }
  }
}
```

Quick check of the hosted twin:

```bash
curl -s -X POST https://newmexicoliteracyproject.org/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## How it works

- **`index.js`** — the standalone local server. Uses `@modelcontextprotocol/sdk` over `StdioServerTransport`; supports `initialize` / `tools/list` / `tools/call`. Its only dependency is the MCP SDK.
- **`functions/api/mcp.js`** — the hosted twin, a [Cloudflare Pages Function](https://developers.cloudflare.com/pages/functions/) speaking JSON-RPC 2.0 over HTTP POST (Streamable HTTP) with `ping` / notifications / CORS / batch support.

Both wrap the site's public open-data APIs (`/api/checker-*.json`, `/api/points.json`, etc.). No credentials or secrets are required or included.

## Links

- Website: <https://newmexicoliteracyproject.org>
- First-edition resource: <https://newmexicoliteracyproject.org/first-editions>
- Dataset (CC BY 4.0): <https://newmexicoliteracyproject.org/first-edition/dataset> · DOI [10.5281/zenodo.21184548](https://doi.org/10.5281/zenodo.21184548)
- Manifest: [`server.json`](./server.json)

---

The New Mexico Literacy Project is a for-profit book, clothing, and gear donation-and-resale operation in Albuquerque, NM. Donations are not tax-deductible.

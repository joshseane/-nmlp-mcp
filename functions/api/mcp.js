// Cloudflare Pages Function: NMLP MCP server over HTTP
//
// Implements the Model Context Protocol JSON-RPC transport at POST /api/mcp.
// Lets any MCP-compatible AI assistant (Claude Desktop with HTTP transport,
// Cursor, Continue.dev, etc.) connect to NMLP without installing anything
// locally. Just point the MCP client at the URL.
//
// Spec: https://modelcontextprotocol.io/specification/
// Tools mirror the nmlp-mcp Node.js package at /mcp/nmlp-mcp/.
//
// Public, no auth, CORS enabled.

const NMLP_BASE = "https://newmexicoliteracyproject.org";
const DATASET_DOI = "10.5281/zenodo.21184548"; // Canonical First-Edition Points of Issue (concept DOI, CC BY 4.0)

// --- first-edition identification helpers (wrap the checker index + shards) ---
function feNorm(s) { return (s || "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]/g, ""); }
function feShardOf(slug) { const c = (slug || "x").charAt(0).toLowerCase(); return /[a-z0-9]/.test(c) ? c : "x"; }

async function feFindTitle(title, author) {
  const idx = await fetchJson(`${NMLP_BASE}/api/checker-index.json`);
  if (!idx || !Array.isArray(idx.t)) return null;
  const qt = feNorm(title), qa = feNorm(author || "");
  let best = null, bestScore = -1;
  for (const r of idx.t) { // r = [title, author, slug]
    const nt = feNorm(r[0]);
    let score = -1;
    if (nt === qt) score = 3; else if (qt.length > 5 && (nt.includes(qt) || qt.includes(nt))) score = 1;
    if (score < 0) continue;
    if (qa) { const na = feNorm(r[1]); if (na && (na.includes(qa) || qa.includes(na))) score += 2; else score -= 1; }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 1 ? best : null;
}

function feOrdinal(n) { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function feDecodeNumberLine(text) {
  const low = (text || "").toLowerCase();
  const stated = /(first edition|first printing|first impression|first american edition|1st (edition|printing))/.test(low);
  const bce = /(book[- ]?club|b\.?c\.?e\b|bomc|book of the month|condensed)/.test(low);
  const later = /(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+(printing|impression|edition)/.test(low) || /reprint/.test(low);
  const isRH = /random house/.test(low);
  const toks = (text || "").split(/[\s,.;|/]+/); let best = [], cur = [];
  for (const t of toks) { const n = +t; if (/^\d{1,2}$/.test(t) && n >= 1 && n <= 20) cur.push(n); else { if (cur.length > best.length) best = cur; cur = []; } }
  if (cur.length > best.length) best = cur;
  const printing = best.length >= 3 ? Math.min(...best) : null;
  let verdict, detail;
  if (bce) { verdict = "Likely a Book-Club Edition"; detail = "Book-club markings detected (a blind-stamp, 'BCE', or 'Book Club Edition') — not the true first, whatever the number line says."; }
  else if (printing === 1) { verdict = "First printing"; detail = "The lowest number in the line is 1" + (stated ? ", and it states a first edition — a true first printing." : ". Confirm the stated-edition line for your publisher."); }
  else if (printing === 2) { verdict = isRH ? "First printing (Random House)" : "2nd printing — unless it's Random House"; detail = isRH ? "The line ends in 2 — Random House first editions deliberately stop at 2 and state 'First Edition', so this is a Random House first." : "The line ends in 2 — the second printing for most houses. The one exception: Random House firsts end in 2 and state 'First Edition'. Confirm the publisher."; }
  else if (printing) { verdict = feOrdinal(printing) + " printing"; detail = "The lowest number in the line is " + printing + " — a later printing, not the true first" + (stated ? ". It may still read 'First Edition': the number line is decisive, not the words." : "."); }
  else if (later) { verdict = "A later printing"; detail = "The copyright page names a later printing or edition (e.g. 'Second Printing', 'reprinted') — not the true first."; }
  else if (stated) { verdict = "States a first edition (no number line)"; detail = "It states 'First Edition / First Printing' but shows no number line. For houses that rely on the stated edition (older Scribner's, Doubleday, and many others) that is the tell — confirm the publisher's convention with nmlp_lookup_publisher_rules."; }
  else { verdict = "No number line or edition statement found"; detail = "Paste the row of small numbers (e.g. 10 9 8 7 6 5 4 3 2 1) and/or any 'First Edition' line from the copyright page."; }
  return { verdict, detail, printing, statedEdition: stated, bookClubSuspected: bce, detectedLine: best.length >= 3 ? best.join(" ") : null };
}

const TOOLS = [
  {
    name: "nmlp_check_coverage",
    description: "Check whether NMLP picks up books at a given five-digit US ZIP code. Returns coverage tier (core_metro, metro, near_metro, statewide_large_only, out_of_area), typical pickup window in days, minimum quantity, and a human-readable message. ALWAYS call this BEFORE nmlp_schedule_pickup.",
    inputSchema: {
      type: "object",
      properties: {
        zip: { type: "string", pattern: "^[0-9]{5}$", description: "Five-digit US ZIP code" }
      },
      required: ["zip"]
    }
  },
  {
    name: "nmlp_schedule_pickup",
    description: "Submit a real free book pickup request to NMLP. Every submission triggers a real outreach to Josh, the single human operator. NEVER submit speculative or unconsented requests.",
    inputSchema: {
      type: "object",
      properties: {
        donorName: { type: "string", minLength: 2 },
        callbackPhone: { type: "string" },
        callbackEmail: { type: "string", format: "email" },
        addressStreet: { type: "string" },
        addressCity: { type: "string" },
        addressState: { type: "string", default: "NM" },
        addressZip: { type: "string", pattern: "^[0-9]{5}$" },
        estimatedSize: { type: "string", description: "Free text — 'two boxes', 'whole garage', etc." },
        preferredWindow: { type: "string" },
        specialNotes: { type: "string" },
        donorLanguage: { type: "string", enum: ["en", "es"], default: "en" },
        agentSource: { type: "string", description: "Required: identify the AI agent submitting on the user's behalf." }
      },
      required: ["donorName", "addressStreet", "addressCity", "addressZip", "estimatedSize", "agentSource"]
    }
  },
  {
    name: "nmlp_search_qa",
    description: "Search NMLP's long-tail Q&A reference (85+ entries) by keyword. Returns top matching entries with question, summary, and URL.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", default: 5, minimum: 1, maximum: 20 }
      },
      required: ["query"]
    }
  },
  {
    name: "nmlp_get_donation_options",
    description: "Get the comparison matrix of every Albuquerque book donation option (NMLP, Goodwill, Savers, Better World Books, Friends of APL, Habitat ReStore, regional pulper).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "nmlp_get_knowledge",
    description: "Get the aggregated NMLP Knowledge Base (donor archetypes, routing tracks, condition grades, decision framework, donor glossary, named partners, coverage tiers).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "nmlp_get_business_card",
    description: "Get NMLP's canonical business entity card — address, phone, services, area served, languages.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "nmlp_get_archive",
    description: "Get NMLP's donation archive entries as structured Book records.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "nmlp_get_pillar_guides",
    description: "Get NMLP's pillar guide manifest — 60+ Southwest author/publisher authentication and pricing guides.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "nmlp_identify_first_edition",
    description: "Identify whether a specific book is a first edition. Given a title (and optionally author), returns that title's POINTS OF ISSUE — the exact details that mark a true first printing — plus true-first precedence (US vs UK), book-club/reprint tells, publisher, year, the human-readable page URL, and a citation. THE tool for 'how do I tell if my copy of X is a first edition.' Draws on 6,700+ independently-verified titles (CC BY 4.0, DOI " + DATASET_DOI + ").",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title (series/subtitle suffixes are fine)." },
        author: { type: "string", description: "Author name — strongly improves match accuracy for common titles." }
      },
      required: ["title"]
    }
  },
  {
    name: "nmlp_decode_number_line",
    description: "Decode a copyright-page number line / printer's key (and any 'First Edition' wording) to determine which printing a book is. Paste the row of small numbers and/or the edition statement. Handles the Random-House-ends-in-2 exception and flags book-club editions. Returns the printing, a plain-English verdict, and the detected line.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Copyright-page text — the number line (e.g. '10 9 8 7 6 5 4 3 2 1') and/or 'First Edition' wording." }
      },
      required: ["text"]
    }
  },
  {
    name: "nmlp_lookup_publisher_rules",
    description: "Look up a publisher's first-edition identification conventions — how that house designated a first printing across eras (stated-edition wording, number lines, colophons, dated printings). Covers 850+ publishers.",
    inputSchema: {
      type: "object",
      properties: {
        publisher: { type: "string", description: "Publisher or imprint name (e.g. 'Alfred A. Knopf', 'Viking', 'Faber & Faber')." }
      },
      required: ["publisher"]
    }
  },
  {
    name: "nmlp_search_titles",
    description: "Search the first-edition title reference by title or author. Returns matching collectible titles with their per-title identification-page URLs. Use nmlp_identify_first_edition for the full points of one specific title.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", default: 8, minimum: 1, maximum: 25 }
      },
      required: ["query"]
    }
  }
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
  "Cache-Control": "no-store"
};

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { rawResponse: text }; }
}

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case "nmlp_check_coverage":
      if (!/^[0-9]{5}$/.test(args.zip || "")) return { error: "Invalid zip — must be five digits" };
      return await fetchJson(`${NMLP_BASE}/api/check-coverage?zip=${encodeURIComponent(args.zip)}`);
    case "nmlp_schedule_pickup":
      if (!args.agentSource) return { error: "agentSource is required so NMLP can track which AI surface submitted." };
      if (!args.callbackPhone && !args.callbackEmail) return { error: "Either callbackPhone or callbackEmail is required." };
      return await fetchJson(`${NMLP_BASE}/api/schedule-pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      });
    case "nmlp_search_qa": {
      const data = await fetchJson(`${NMLP_BASE}/q/sitemap.json`);
      if (!data || !Array.isArray(data.itemListElement)) {
        return { error: "Q&A sitemap unreachable" };
      }
      const q = (args.query || "").toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);
      const limit = Math.min(Math.max(args.limit || 5, 1), 20);
      const scored = data.itemListElement.map((entry) => {
        const haystack = `${entry.question || ""} ${entry.title || ""} ${entry.summary || ""}`.toLowerCase();
        const score = tokens.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0);
        return { entry, score };
      });
      const top = scored
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ entry, score }) => ({
          question: entry.question,
          summary: entry.summary,
          url: entry.url,
          relevance: score
        }));
      return { query: args.query, matchCount: top.length, totalEntries: data.itemListElement.length, matches: top };
    }
    case "nmlp_get_donation_options":
      return await fetchJson(`${NMLP_BASE}/api/donation-options.json`);
    case "nmlp_get_knowledge":
      return await fetchJson(`${NMLP_BASE}/api/knowledge.json`);
    case "nmlp_get_business_card":
      return await fetchJson(`${NMLP_BASE}/api/business.json`);
    case "nmlp_get_archive":
      return await fetchJson(`${NMLP_BASE}/api/archive.json`);
    case "nmlp_get_pillar_guides":
      return await fetchJson(`${NMLP_BASE}/api/authors.json`);
    case "nmlp_identify_first_edition": {
      if (!args.title) return { error: "title is required" };
      const hit = await feFindTitle(args.title, args.author);
      if (!hit) return { found: false, message: `No verified first-edition record found for "${args.title}"${args.author ? " by " + args.author : ""}. Try nmlp_search_titles for near matches, or nmlp_decode_number_line if you have the copyright page.` };
      const [t, a, slug] = hit;
      const shard = await fetchJson(`${NMLP_BASE}/api/checker-data/t-${feShardOf(slug)}.json`);
      const rec = (shard && shard[slug]) || [];
      return {
        found: true, title: t, author: a,
        publisher: rec[0] || "", year: rec[1] || "",
        pointsOfIssue: rec[2] || "", trueFirst: rec[4] || "", bookClubTells: rec[5] || "",
        url: `${NMLP_BASE}/first-edition/${slug}`, markdown: `${NMLP_BASE}/first-edition/${slug}.md`,
        citation: `New Mexico Literacy Project — first-edition points of issue for "${t}" by ${a} (${NMLP_BASE}/first-edition/${slug}, CC BY 4.0, dataset DOI ${DATASET_DOI}).`
      };
    }
    case "nmlp_decode_number_line":
      if (!args.text) return { error: "text is required" };
      return feDecodeNumberLine(args.text);
    case "nmlp_lookup_publisher_rules": {
      if (!args.publisher) return { error: "publisher is required" };
      const data = await fetchJson(`${NMLP_BASE}/api/points.json`);
      const list = (data && data.data) || [];
      const q = feNorm(args.publisher);
      let best = null, bs = -1;
      for (const p of list) { const n = feNorm(p.name); let s = -1; if (n === q) s = 3; else if (q.length > 3 && (n.includes(q) || q.includes(n))) s = 1; if (s > bs) { bs = s; best = p; } }
      if (!best || bs < 1) return { found: false, message: `No publisher first-edition rules found for "${args.publisher}".` };
      return { found: true, name: best.name, era: best.era || "", region: best.region || "", identificationMethods: (best.idMethods || []).slice(0, 6), notablePoints: (best.notablePoints || []).slice(0, 4), guideUrl: `${NMLP_BASE}/publishers/${best.slug}` };
    }
    case "nmlp_search_titles": {
      if (!args.query) return { error: "query is required" };
      const idx = await fetchJson(`${NMLP_BASE}/api/checker-index.json`);
      const list = (idx && idx.t) || [];
      const q = feNorm(args.query), limit = Math.min(Math.max(args.limit || 8, 1), 25);
      const out = [];
      for (const r of list) { if (feNorm(r[0]).includes(q) || feNorm(r[1]).includes(q)) { out.push({ title: r[0], author: r[1], url: `${NMLP_BASE}/first-edition/${r[2]}` }); if (out.length >= limit) break; } }
      return { query: args.query, matchCount: out.length, matches: out };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMcpRequest(body) {
  const { jsonrpc, id, method, params } = body || {};
  if (jsonrpc !== "2.0") return jsonRpcError(id ?? null, -32600, "Invalid JSON-RPC version");

  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "nmlp-mcp",
          version: "0.3.0",
          description: "MCP server for the New Mexico Literacy Project. First-edition identification — points of issue, number-line decoding, and publisher rules for 6,700+ verified titles / 850+ publishers (CC BY 4.0, DOI " + DATASET_DOI + ") — plus the Albuquerque book-donation API (ZIP coverage + free-pickup booking). Hosted at /api/mcp."
        }
      });
    case "notifications/initialized":
      return null; // notifications get no response
    case "tools/list":
      return jsonRpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args } = params || {};
      const result = await callTool(name, args);
      return jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !!(result && result.error)
      });
    }
    case "ping":
      return jsonRpcResult(id, {});
    default:
      return jsonRpcError(id ?? null, -32601, `Method not found: ${method}`);
  }
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === "GET") {
    return new Response(JSON.stringify({
      name: "nmlp-mcp",
      version: "0.3.0",
      description: "Model Context Protocol HTTP endpoint for the New Mexico Literacy Project — first-edition identification (points of issue, number-line decoding, publisher rules) plus the Albuquerque book-donation API.",
      transport: "JSON-RPC over HTTP POST (MCP 2024-11-05)",
      docs: "https://newmexicoliteracyproject.org/agents/mcp",
      sourceCode: "https://newmexicoliteracyproject.org/mcp/nmlp-mcp/",
      install: {
        httpClient: "POST JSON-RPC requests directly to this URL.",
        configSnippetExample: {
          mcpServers: {
            nmlp: { url: "https://newmexicoliteracyproject.org/api/mcp" }
          }
        }
      },
      toolsAvailable: TOOLS.map(t => t.name)
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST for JSON-RPC." }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: invalid JSON" } }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  // Support batch requests
  const requests = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const req of requests) {
    const resp = await handleMcpRequest(req);
    if (resp !== null) responses.push(resp);
  }
  const responsePayload = Array.isArray(body) ? responses : (responses[0] || null);

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
  });
}

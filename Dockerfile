# NMLP MCP is a HOSTED, remote server (Streamable HTTP) at:
#   https://newmexicoliteracyproject.org/api/mcp
# There is nothing to install to use it — point any MCP client at that URL.
#
# This Dockerfile exists only so directory crawlers (e.g. Glama) can "start the server
# and respond to introspection requests": it runs mcp-remote as a stdio<->HTTP bridge to
# the live hosted endpoint, so initialize / tools/list resolve to the real 12 tools.
FROM node:20-alpine
RUN apk add --no-cache dumb-init
ENTRYPOINT ["dumb-init", "npx", "-y", "mcp-remote", "https://newmexicoliteracyproject.org/api/mcp"]

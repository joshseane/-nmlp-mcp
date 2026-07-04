# NMLP MCP server — local stdio build.
#
# Builds and runs the standalone Node MCP server (index.js) in-container and
# speaks MCP over stdio, so MCP clients and directory crawlers (e.g. Glama) can
# start it and introspect the real 12 tools. tools/list is served entirely from
# local code; the reference-data tools fetch the NMLP public CC-BY JSON API at
# call time. (A hosted HTTP twin also runs at
# https://newmexicoliteracyproject.org/api/mcp.)
FROM node:20-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENTRYPOINT ["dumb-init", "node", "index.js"]

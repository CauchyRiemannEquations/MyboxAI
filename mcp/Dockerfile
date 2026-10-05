FROM node:22-bookworm-slim AS build
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mcp/src ./src
COPY mcp/scripts ./scripts
COPY lib /app/lib
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app/mcp
COPY --from=build --chown=node:node /app/mcp/node_modules ./node_modules
COPY --from=build --chown=node:node /app/mcp/dist ./dist
USER node
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node", "dist/http.mjs"]

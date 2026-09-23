# ---- Build stage -----------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3 when no prebuilt binary matches.
RUN apk add --no-cache python3 make g++

# Install dependencies (cached unless the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend, then drop dev dependencies for the runtime image.
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage ---------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist

# The server runs its TypeScript sources directly (Node type stripping).
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY docker/entrypoint.sh /entrypoint.sh

# SQLite database (app.db) and uploaded files (storage/) live here.
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.ts"]

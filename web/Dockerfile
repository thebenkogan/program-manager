# Build context is the repo root: docker build -f web/Dockerfile .
# Stage 1 installs everything and builds the SPA. Stage 2 is the runtime: production deps only, non-root.
FROM oven/bun:1 AS build
WORKDIR /app
COPY src/shared ./src/shared
COPY web/package.json web/bun.lock ./web/
WORKDIR /app/web
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bunx vite build

FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src/shared ./src/shared
COPY web/package.json web/bun.lock ./web/
WORKDIR /app/web
RUN bun install --frozen-lockfile --production
COPY web/server ./server
COPY web/shared ./shared
COPY web/drizzle ./drizzle
COPY web/scripts ./scripts
COPY --from=build /app/web/dist ./dist
# Trust only the mounted client data repo, not every repo on the system.
RUN git config --system --add safe.directory /data
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
USER bun
EXPOSE 3000
CMD ["bun", "run", "server/index.ts"]

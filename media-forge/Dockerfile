# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace
COPY . .
RUN pnpm exec tsup

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production MEDIA_FORGE_HTTP_PORT=3000
# ffmpeg de sistema (LGPL-safe): resolveFfmpegPath() o encontra; ffmpeg-static foi removido na Fase 1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
 && apk add --no-cache ffmpeg
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-workspace --prod
COPY --from=build /app/dist ./dist
# Ship the SQLite migrations: runMigrations resolves MIGRATIONS_DIR to
# /app/migrations/sqlite at runtime (dist/http/server.js -> ../../migrations/sqlite).
# Without this the runtime image lacks them, so video_jobs is never created and
# cost-tracker/gallery/refs (+ the F-E sweep oracle) fail with "no such table".
COPY --from=build /app/migrations ./migrations
EXPOSE 3000
# 127.0.0.1 (não localhost): server binda 0.0.0.0 IPv4; localhost resolve ::1 (IPv6) → refused
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/http/server.js"]

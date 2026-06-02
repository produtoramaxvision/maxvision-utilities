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
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/http/server.js"]

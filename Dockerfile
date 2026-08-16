# syntax=docker/dockerfile:1.7
# ---- build stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Install with a warm cache first (only manifests), then copy sources.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
ARG APP_VERSION=0.1.0
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @totetrack/web build && pnpm --filter @totetrack/server build
# Flat production node_modules for the server only (native deps built for linux here).
RUN pnpm --filter @totetrack/server deploy --prod /out/server
# Pre-create the photo directory owned by the runtime user; a fresh named volume inherits it.
RUN mkdir -p /out/data/photos && chown -R 65532:65532 /out/data

# ---- cloudflare connector binary -------------------------------------------
# The app supervises `cloudflared` itself (token pasted in Settings), so bundle the static binary.
FROM cloudflare/cloudflared:latest AS cloudflared

# ---- runtime stage (distroless) --------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
ENV NODE_ENV=production \
    PORT=3000 \
    PHOTO_DIR=/data/photos \
    WEB_DIST=/app/public \
    MIGRATIONS_DIR=/app/drizzle
COPY --from=build --chown=nonroot:nonroot /out/server/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/apps/server/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/apps/server/drizzle ./drizzle
COPY --from=build --chown=nonroot:nonroot /app/apps/web/dist ./public
COPY --from=build --chown=nonroot:nonroot /app/apps/server/package.json ./package.json
# Photos live on a named volume; the mount point must be writable by nonroot (uid 65532).
COPY --from=build --chown=nonroot:nonroot /out/data /data
USER nonroot
EXPOSE 3000
VOLUME ["/data/photos"]
CMD ["dist/index.js"]

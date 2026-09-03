# Libra-Nextgen server image — TEMPLATE build mode (default).
# The server packages agent payloads from prebuilt templates downloaded from
# the GitHub release (LIBRA_BUILDER_MODE=template); no Rust toolchain, zig or
# agent-rs source tree is baked in, so the image stays small and runs on any
# architecture (buildx supports linux/amd64 + linux/arm64).
#
# Build args:
#   VITE_API_BASE  API origin baked into the console (required for single-port 443)
#
# Source compilation (LIBRA_BUILDER_MODE=source) is a bare-metal dev option only:
# no in-image Rust toolchain exists, and Docker deployments always run template mode.

# ── Stage 1: console SPA ────────────────────────────────────────────────
FROM node:22-alpine AS console
WORKDIR /web
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
COPY src/console/package.json src/console/package-lock.json ./
RUN npm ci
COPY src/console/ ./
RUN npm run build

# ── Stage 2: publish server ─────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS publish
WORKDIR /src
COPY src/LibraNextgen.Common/ LibraNextgen.Common/
COPY src/LibraNextgen.Server/ LibraNextgen.Server/
RUN dotnet publish LibraNextgen.Server/LibraNextgen.Server.csproj -c Release -o /out

# ── Stage 3: runtime ────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0

ENV ASPNETCORE_ENVIRONMENT=Production \
    LIBRA_BUILDER_MODE=template \
    LIBRA_BUILDS_DIR=/build-output \
    LIBRA_SERVER_KEY=/secrets/server-rsa.key

# curl for healthcheck (template downloads need no extra packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=publish /app /app
COPY --from=console /web/dist /srv/console

COPY deploy/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5270
VOLUME ["/build-output", "/secrets", "/root/.config/Libra-Nextgen"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sS -o /dev/null http://127.0.0.1:5270/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]

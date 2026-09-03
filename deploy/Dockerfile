# Libra-Nextgen server image (includes the online agent-build toolchain).
# Ships: console SPA (/srv/console), Libra-Server (/app), and a rust+zig
# toolchain for building win x64 / win x86 (GNU ABI, cross) and linux x64
# (native) agents.
#
# Build args:
#   VITE_API_BASE  API origin baked into the console (required for single-port 443)
#   ZIG_VERSION    zig version pinned for cargo-zigbuild compatibility
#   RUST_TARGETS   rustup targets preinstalled in the image (space separated)
#
# NOTE: linux/amd64 only (the agent linux target is x86_64-unknown-linux-gnu).

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
    LIBRA_BUILDS_DIR=/build-output \
    LIBRA_AGENT_RS_DIR=/agent-rs \
    LIBRA_SERVER_KEY=/secrets/server-rsa.key \
    PATH="/root/.cargo/bin:/usr/local/bin:${PATH}"

# Native linker for linux-x64 builds; curl for healthcheck; git for cargo deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkg-config ca-certificates curl git libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Optional mirror overrides for restricted networks (compose/.env; empty = official sources)
ARG RUSTUP_DIST_SERVER="https://static.rust-lang.org"
ARG RUSTUP_UPDATE_ROOT="https://static.rust-lang.org/rustup"
ARG CARGO_REGISTRY_INDEX=""
RUN if [ -n "$CARGO_REGISTRY_INDEX" ]; then \
        mkdir -p /root/.cargo && \
        printf '[source.crates-io]\nreplace-with = "mirror"\n[source.mirror]\nregistry = "%s"\n' "$CARGO_REGISTRY_INDEX" > /root/.cargo/config.toml; \
    fi

# Rust toolchain + target stds
ARG RUST_TARGETS="x86_64-unknown-linux-gnu x86_64-pc-windows-gnu i686-pc-windows-gnu"
RUN export RUSTUP_DIST_SERVER="${RUSTUP_DIST_SERVER:-https://static.rust-lang.org}" \
 && export RUSTUP_UPDATE_ROOT="${RUSTUP_UPDATE_ROOT:-https://static.rust-lang.org/rustup}" \
 && curl -fsSL https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable \
 && rustup target add ${RUST_TARGETS} \
 && rustc --version && cargo --version

# zig (cross linker used by cargo-zigbuild; bundles glibc/msvc runtimes)
ARG ZIG_VERSION=0.14.1
ARG ZIG_BASE_URL=""
RUN curl -fSL --retry 5 --retry-delay 5 --connect-timeout 20 \
        "${ZIG_BASE_URL:-https://ziglang.org/download}/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz \
    && mkdir -p /usr/local/zig \
    && tar -xJf /tmp/zig.tar.xz -C /usr/local/zig --strip-components=1 \
    && ln -sf /usr/local/zig/zig /usr/local/bin/zig \
    && rm /tmp/zig.tar.xz \
    && zig version

# cargo-zigbuild (latest stable from crates.io; adjust ZIG_VERSION on pairing changes)
# CARGO_REGISTRY_INDEX is a build-arg only; unset it so cargo does not read it as
# the deprecated registry.index config (the mirror is applied via config.toml above).
RUN unset CARGO_REGISTRY_INDEX && cargo install cargo-zigbuild --locked --root /usr/local \
    && ls -la /usr/local/bin | grep zigbuild

# agent-rs workspace; pre-fetch deps so runtime builds work without network
COPY src/agent-rs/ /agent-rs/
RUN unset CARGO_REGISTRY_INDEX && (cargo fetch --manifest-path /agent-rs/Cargo.toml || echo "[warn] cargo fetch failed")

COPY --from=publish /out /app
COPY --from=console /web/dist /srv/console

COPY deploy/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5270
VOLUME ["/build-output", "/secrets", "/root/.config/Libra-Nextgen"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sS -o /dev/null http://127.0.0.1:5270/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]
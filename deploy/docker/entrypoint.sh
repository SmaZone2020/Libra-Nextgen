#!/bin/sh
# Libra-Nextgen container entrypoint: ensure persistent dirs exist, then run the server.
set -e

: "${LIBRA_BUILDS_DIR:=/build-output}"
: "${LIBRA_SERVER_KEY:=/secrets/server-rsa.key}"

mkdir -p "$LIBRA_BUILDS_DIR" "$(dirname "$LIBRA_SERVER_KEY")" /root/.config/Libra-Nextgen

# Publish the baked SPA into the shared console volume (nginx serves it).
# Always re-sync so an image upgrade updates the served frontend.
if [ -d /srv/console ] && [ -d /srv/console-live ]; then
    find /srv/console-live -mindepth 1 -delete 2>/dev/null || true
    cp -a /srv/console/. /srv/console-live/
fi

exec dotnet /app/LibraNextgen.Server.dll "$@"
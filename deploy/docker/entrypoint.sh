#!/bin/sh
# Libra-Nextgen container entrypoint: ensure persistent dirs exist, then run the server.
set -e

: "${LIBRA_BUILDS_DIR:=/build-output}"
: "${LIBRA_SERVER_KEY:=/secrets/server-rsa.key}"

mkdir -p "$LIBRA_BUILDS_DIR" "$(dirname "$LIBRA_SERVER_KEY")" /root/.config/Libra-Nextgen

exec dotnet /app/service.dll "$@"
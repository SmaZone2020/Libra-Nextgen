#!/usr/bin/env bash
# Stage the built artifacts into a per-platform template zip consumed by the
# Server's template-mode builder (TemplateManagerService.InstallZip).
#
# Inputs (env): PLATFORM (x64/linux-x64/linux-arm64/win-arm64/mac-arm64),
# TRIPLE, TAG, SHA. Expects cargo artifacts under target/${TRIPLE}/release.
set -euo pipefail

R="target/${TRIPLE}/release"
OUT="template-out"
rm -rf "${OUT}"
mkdir -p "${OUT}"

case "${TRIPLE}" in
  *-windows-*)
    EXT="dll"
    CORE="core.dll"
    LOADER="loader.exe"
    ;;
  *-apple-darwin)
    EXT="dylib"
    CORE="libcore.dylib"
    LOADER="loader"
    ;;
  *)
    EXT="so"
    CORE="libcore.so"
    LOADER="loader"
    ;;
esac

# Loader (+ Windows desktop variant when present).
cp "${R}/${LOADER}" "${OUT}/${LOADER}"
if [ -f "${R}/loader_desktop.exe" ]; then
  cp "${R}/loader_desktop.exe" "${OUT}/loader_desktop.exe"
fi

# Core cdylib.
cp "${R}/${CORE}" "${OUT}/${CORE}"

# Cloud modules, renamed to the canonical {module}.{ext} served by the server.
# PKGS lists the cargo packages this platform built as "-p name ..." tokens
# (subset for win-arm64); module tokens are derived by stripping "-module".
: "${PKGS:=-p core -p loader -p shell-module -p recon-module -p creds-module -p files-module -p powershell-module -p proxy-module -p script-module}"
MODULES=""
for p in ${PKGS}; do
  case "${p}" in
    -p|core|loader) ;;
    *) MODULES="${MODULES} ${p%-module}" ;;
  esac
done
for m in ${MODULES}; do
  if [ -f "${R}/lib${m}_module.${EXT}" ]; then
    cp "${R}/lib${m}_module.${EXT}" "${OUT}/${m}.${EXT}"
  elif [ -f "${R}/${m}_module.${EXT}" ]; then
    cp "${R}/${m}_module.${EXT}" "${OUT}/${m}.${EXT}"
  else
    echo "::error::module artifact missing: ${m}_module.${EXT}"
    exit 1
  fi
done

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "${OUT}/manifest.json" <<EOF
{"platform":"${PLATFORM}","tag":"${TAG}","commit":"${SHA}","built_at":"${BUILT_AT}"}
EOF

ZIP="libra-agent-tpl-${PLATFORM}.zip"
rm -f "${ZIP}"
if command -v zip >/dev/null 2>&1; then
  (cd "${OUT}" && zip -qr "../${ZIP}" .)
else
  # Git-for-Windows bash has no zip; fall back to PowerShell Compress-Archive.
  powershell -NoProfile -Command "\$ErrorActionPreference='Stop'; Get-ChildItem -Path 'template-out/*' | Compress-Archive -DestinationPath '${ZIP}' -Force"
fi
echo "packed ${ZIP}:"
ls -la "${ZIP}"

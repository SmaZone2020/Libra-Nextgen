# One-shot release push: sync main, move the release tag to HEAD and force-push
# it so the tag-triggered workflows (release-assets.yml, templates.yml) and the
# branch CI (ci.yml) run against the latest code.
#
# Run from the repo root on a machine that can reach github.com:
#   pwsh scripts/push-release.ps1 -Tag 1.7.0
param(
    [string]$Tag = '1.7.0'
)

$ErrorActionPreference = 'Stop'
$repo = git remote get-url origin
Write-Host "remote: $repo"

# Fail fast when the network cannot reach the git host.
git ls-remote origin HEAD *> $null
if ($LASTEXITCODE -ne 0) { throw "cannot reach git remote - run this on a machine with github.com access" }

Write-Host "== pushing main (triggers ci.yml) =="
git push origin main
if ($LASTEXITCODE -ne 0) { throw "push main failed" }

Write-Host "== moving tag $Tag to HEAD ($(git rev-parse --short HEAD)) =="
git tag -f $Tag HEAD

Write-Host "== force-pushing tag $Tag (triggers release-assets.yml + templates.yml) =="
git push origin $Tag --force
if ($LASTEXITCODE -ne 0) {
    Write-Host "force push rejected - retrying as delete + recreate"
    git push origin ":$Tag" *> $null
    git push origin $Tag
    if ($LASTEXITCODE -ne 0) { throw "tag push failed" }
}

git ls-remote origin "refs/tags/$Tag"
Write-Host ""
Write-Host "OK. Actions should now be running:"
Write-Host "  https://github.com/SmaZone2020/Libra-Nextgen/actions"
Write-Host "After the release job finishes, the GitHub Release for $Tag appears with all assets."

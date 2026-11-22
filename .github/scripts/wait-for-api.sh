#!/usr/bin/env bash
# Waits until the live API says it runs the given commit (GET /health -> data.commit),
# so CI's deploy-api job only goes green once Render has really put that commit live.
# A deploy that fails on Render's side (build, migration, start) times out here and
# turns the run red; the next push to main then compares with the last green commit
# and deploys the backend again.
#
#   .github/scripts/wait-for-api.sh <commit> [url] [timeout seconds]
#
# Try it by hand: with the live commit it passes at once; with a made-up one and a
# short timeout it fails.
set -euo pipefail

want="${1:?commit sha}"
url="${2:-https://api.4vd.app/health}"
limit="${3:-1200}"
every=15
started=$(date +%s)

while :; do
  body=$(curl -fsS --max-time 10 "$url" 2>/dev/null || true)
  live=$(printf '%s' "$body" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')
  if [ "$live" = "$want" ]; then
    echo "The API at $url is live on $want."
    exit 0
  fi
  waited=$(( $(date +%s) - started ))
  if [ "$waited" -ge "$limit" ]; then
    echo "::error::After ${waited}s the API still runs ${live:-an unknown commit}, not $want. Look at Render -> 4vd-api -> Events: the deploy may have failed. The next push to main deploys the backend again; or use Manual Deploy there."
    exit 1
  fi
  echo "Live: ${live:-unknown}; waiting for $want (${waited}s)..."
  sleep "$every"
done

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${DEPLOY_BRANCH:-main}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "ABORT: HEAD ($LOCAL) != origin/$BRANCH ($REMOTE). Resolve before deploying." >&2
  exit 1
fi

export GIT_SHA="$(git rev-parse --short HEAD)"
export GIT_BRANCH="$BRANCH"
echo "Deploying $GIT_BRANCH @ $GIT_SHA"

docker compose build --no-cache
docker compose up -d

# verify the running container reports the SHA we just built
sleep 8
LIVE=$(curl -s --max-time 15 http://localhost:3001/health | grep -o '"gitSha":"[^"]*"' || true)
echo "Live /health → $LIVE"
case "$LIVE" in
  *"$GIT_SHA"*) echo "OK: live SHA matches built SHA." ;;
  *) echo "WARNING: live SHA does not match $GIT_SHA — investigate." >&2; exit 1 ;;
esac

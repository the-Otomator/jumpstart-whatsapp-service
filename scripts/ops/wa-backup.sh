#!/usr/bin/env bash
# Encrypt sessions/config with age and upload to the private R2 bucket.
set -Eeuo pipefail
umask 077

# shellcheck disable=SC1091
. /etc/wa-backup.env
: "${AGE_PUBLIC_KEY:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_ENDPOINT:?}"
R2_BUCKET="${R2_BUCKET:-wa-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
APP_DIR="${APP_DIR:-/opt/whatsapp-service}"
STATE=/var/lib/wa-backup
mkdir -p "$STATE"
HOST="$(hostname -s)"; TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
trap 'code=$?; printf "FAIL %s exit=%s\n" "$TS" "$code" > "$STATE/last_status"; exit "$code"' ERR

VOLUME="$(docker volume ls -q | grep -E '(^|_)sessions-data$' | head -n1)"
[ -n "$VOLUME" ] || { echo "sessions-data volume not found" >&2; exit 1; }
MOUNTPOINT="$(docker volume inspect -f '{{.Mountpoint}}' "$VOLUME")"
[ -d "$MOUNTPOINT" ] || { echo "volume mountpoint missing" >&2; exit 1; }

mkdir -p "$WORK/stage/config"
cp -a "$APP_DIR/.env" "$WORK/stage/config/app.env"
for file in /etc/nginx/sites-enabled/* /etc/nginx/nginx.conf "$APP_DIR/docker-compose.yml"; do
  [ -e "$file" ] && cp -aL "$file" "$WORK/stage/config/"
done
git -C "$APP_DIR" rev-parse HEAD > "$WORK/stage/config/git-head" 2>/dev/null || true

ARCHIVE="$WORK/wa-$HOST-$TS.tar.gz.age"
tar -czf - --warning=no-file-changed --exclude='./*/media' \
  --transform 's,^\./,sessions/,' -C "$MOUNTPOINT" . \
  -C "$WORK/stage" config \
  | age -r "$AGE_PUBLIC_KEY" -o "$ARCHIVE"
SIZE="$(stat -c %s "$ARCHIVE")"
[ "$SIZE" -gt 1024 ] || { echo "archive too small" >&2; exit 1; }

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
KEY="$HOST/$(date -u +%Y/%m)/$(basename "$ARCHIVE")"
aws s3 cp --only-show-errors --endpoint-url "$R2_ENDPOINT" "$ARCHIVE" "s3://$R2_BUCKET/$KEY"

CUTOFF="$(date -u -d "-$RETENTION_DAYS days" +%Y%m%d)"
aws s3 ls --endpoint-url "$R2_ENDPOINT" --recursive "s3://$R2_BUCKET/$HOST/" | awk '{print $4}' | while read -r key; do
  date_part="$(grep -oE '[0-9]{8}T' <<<"$key" | tr -d T || true)"
  [ -n "$date_part" ] && [ "$date_part" -lt "$CUTOFF" ] && aws s3 rm --only-show-errors --endpoint-url "$R2_ENDPOINT" "s3://$R2_BUCKET/$key"
done

date +%s > "$STATE/last_success"
printf 'OK %s %s %s\n' "$TS" "$KEY" "$SIZE" > "$STATE/last_status"
printf 'OK %s (%s bytes)\n' "$KEY" "$SIZE"

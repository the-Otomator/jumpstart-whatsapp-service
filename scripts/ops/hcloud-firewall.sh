#!/usr/bin/env bash
# Create/replace wa-fw and attach it to wa-prod-1. HCLOUD_TOKEN is read from the environment.
set -euo pipefail

: "${HCLOUD_TOKEN:?set HCLOUD_TOKEN}"
SERVER="${SERVER:-wa-prod-1}"
FW="${FW:-wa-fw}"
command -v hcloud >/dev/null || { echo "hcloud CLI is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

rules="$(mktemp)"
trap 'rm -f "$rules"' EXIT
cf="$( (curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4; curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6) | grep . | jq -R . | jq -s .)"
[ "$(jq length <<<"$cf")" -ge 15 ] || { echo "Cloudflare range list failed sanity check" >&2; exit 1; }
jq -n --argjson cf "$cf" '[
  {direction:"in",protocol:"tcp",port:"22",source_ips:["0.0.0.0/0","::/0"],description:"ssh key-only plus fail2ban"},
  {direction:"in",protocol:"tcp",port:"80",source_ips:$cf,description:"http cloudflare"},
  {direction:"in",protocol:"tcp",port:"443",source_ips:$cf,description:"https cloudflare"}
]' > "$rules"

hcloud firewall describe "$FW" >/dev/null 2>&1 || hcloud firewall create --name "$FW" >/dev/null
hcloud firewall replace-rules "$FW" --rules-file "$rules"
if ! hcloud firewall describe "$FW" -o json | jq -e --arg server "$SERVER" '.applied_to[]? | select(.server.name == $server)' >/dev/null; then
  hcloud firewall apply-to-resource "$FW" --type server --server "$SERVER"
fi
hcloud firewall describe "$FW"

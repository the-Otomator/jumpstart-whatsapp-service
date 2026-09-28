#!/usr/bin/env bash
# Restrict host ingress to admin SSH and Cloudflare HTTP(S); safe to rerun for range refreshes.
set -euo pipefail

ADMIN_IPS="${ADMIN_IPS:?space-separated admin IPv4/IPv6 CIDRs}"
TAG=wa-managed
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 -o "$work/v4"
curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6 -o "$work/v6"
n4="$(grep -c . "$work/v4")"; n6="$(grep -c . "$work/v6")"
[ "$n4" -ge 10 ] && [ "$n6" -ge 5 ] || { echo "Cloudflare range list failed sanity check ($n4/$n6)" >&2; exit 1; }

command -v ufw >/dev/null || { apt-get update -qq; apt-get install -y -qq ufw >/dev/null; }

# Add replacement rules before removing obsolete or broad rules.
for ip in $ADMIN_IPS; do ufw allow proto tcp from "$ip" to any port 22 comment "$TAG ssh-admin" >/dev/null; done
for ip in ${EXTRA_SSH_IPS:-}; do ufw allow proto tcp from "$ip" to any port 22 comment "$TAG ssh-extra" >/dev/null; done
while read -r cidr; do
  [ -n "$cidr" ] && ufw allow proto tcp from "$cidr" to any port 80,443 comment "$TAG web-cf" >/dev/null
done < <(cat "$work/v4" "$work/v6")

keep="$(cat "$work/v4" "$work/v6")"
mapfile -t delete_numbers < <(ufw status numbered | while IFS= read -r line; do
  number="$(sed -nE 's/^\[ *([0-9]+)\].*/\1/p' <<<"$line")"
  [ -n "$number" ] || continue
  if grep -Eq '(22|80|443|80,443)(/tcp)?( \(v6\))? +ALLOW IN +Anywhere|(OpenSSH|Nginx [A-Za-z]+)( \(v6\))? +ALLOW IN +Anywhere' <<<"$line"; then
    echo "$number"; continue
  fi
  if grep -q "$TAG web-cf" <<<"$line"; then
    source="$(awk '{for(i=1;i<=NF;i++) if($i=="IN"){print $(i+1); exit}}' <<<"${line#*]}")"
    grep -qxF "$source" <<<"$keep" || echo "$number"
  fi
done | sort -rn)
for number in "${delete_numbers[@]}"; do yes | ufw delete "$number" >/dev/null; done

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status verbose
ss -ltnp | grep -E ':3001\b' || true

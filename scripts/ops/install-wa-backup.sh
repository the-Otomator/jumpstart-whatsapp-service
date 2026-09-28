#!/usr/bin/env bash
# Install the backup script and nightly systemd timer. /etc/wa-backup.env must already exist.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -s /etc/wa-backup.env ] || { echo "/etc/wa-backup.env is missing or empty" >&2; exit 1; }
chmod 600 /etc/wa-backup.env
chown root:root /etc/wa-backup.env
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq age awscli >/dev/null
install -m 755 "$(dirname "$0")/wa-backup.sh" /usr/local/bin/wa-backup

cat > /etc/systemd/system/wa-backup.service <<'UNIT'
[Unit]
Description=Encrypted offsite backup of WhatsApp sessions to R2
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/wa-backup
Nice=10
IOSchedulingClass=idle
UNIT

cat > /etc/systemd/system/wa-backup.timer <<'UNIT'
[Unit]
Description=Nightly WhatsApp backup

[Timer]
OnCalendar=*-*-* 03:15:00 Asia/Jerusalem
RandomizedDelaySec=5m
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now wa-backup.timer
systemctl list-timers wa-backup.timer --no-pager

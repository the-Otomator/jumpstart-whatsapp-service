#!/usr/bin/env bash
# Install the backup script and nightly systemd timer. /etc/wa-backup.env must already exist.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -s /etc/wa-backup.env ] || { echo "/etc/wa-backup.env is missing or empty" >&2; exit 1; }
chmod 600 /etc/wa-backup.env
chown root:root /etc/wa-backup.env
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq age curl unzip >/dev/null

# Ubuntu 24.04 (noble) does not ship the awscli apt package. Install the
# official AWS CLI v2 bundle, selecting the host architecture. The installer
# owns /usr/local/aws-cli and exposes /usr/local/bin/aws for the systemd unit.
if ! command -v aws >/dev/null 2>&1; then
  case "$(uname -m)" in
    x86_64) aws_arch=x86_64 ;;
    aarch64|arm64) aws_arch=aarch64 ;;
    *) echo "unsupported architecture for AWS CLI v2: $(uname -m)" >&2; exit 1 ;;
  esac
  aws_work="$(mktemp -d)"
  trap 'rm -rf "$aws_work"' EXIT
  curl --fail --silent --show-error --location \
    "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" \
    --output "$aws_work/awscliv2.zip"
  unzip -q "$aws_work/awscliv2.zip" -d "$aws_work"
  "$aws_work/aws/install" --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli
fi
aws --version
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

#!/usr/bin/env bash
# Configure key-only SSH, a non-root deploy user, fail2ban, and unattended security updates.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PUBKEYS_FILE="${DEPLOY_PUBKEYS_FILE:?set DEPLOY_PUBKEYS_FILE to a non-empty public-key file}"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -s "$DEPLOY_PUBKEYS_FILE" ] || { echo "deploy public-key file is empty" >&2; exit 1; }
[ -s /root/.ssh/authorized_keys ] || { echo "root has no authorized keys; refusing" >&2; exit 1; }

id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG sudo "$DEPLOY_USER"
getent group docker >/dev/null && usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PUBKEYS_FILE" "/home/$DEPLOY_USER/.ssh/authorized_keys"
printf '%s\n' "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"
visudo -cf "/etc/sudoers.d/90-$DEPLOY_USER"

cat > /etc/ssh/sshd_config.d/99-wa-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
CONF

# OpenSSH uses the first value it encounters. Remove conflicting values from earlier drop-ins.
for file in /etc/ssh/sshd_config.d/*.conf; do
  [ "$file" = /etc/ssh/sshd_config.d/99-wa-hardening.conf ] && continue
  sed -i -E 's/^[[:space:]]*(PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PermitEmptyPasswords|PubkeyAuthentication|PermitRootLogin|MaxAuthTries|LoginGraceTime)[[:space:]]+/# disabled by 99-wa-hardening: &/' "$file"
done
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq fail2ban unattended-upgrades >/dev/null
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/51wa-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Package-Blacklist { "docker-ce"; "docker-ce-cli"; "containerd.io"; };
CONF

sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication|maxauthtries) '
fail2ban-client status sshd | sed -n '1,5p'
echo "Test a second root login and a deploy login before closing the original root session."

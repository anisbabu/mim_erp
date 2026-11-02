#!/usr/bin/env bash
# One-shot installer for a fresh Ubuntu/Debian server. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/anisbabu/mim_erp/master/deploy/server-setup.sh | SITE=http://1.2.3.4 bash
# SITE = domain (erp.example.com -> automatic HTTPS) or http://SERVER_IP (plain HTTP).
set -euo pipefail
SITE="${SITE:?set SITE=domain or http://ip}"
DIR=/opt/mim-erp

if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
apt-get install -y git >/dev/null 2>&1 || true

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone https://github.com/anisbabu/mim_erp.git "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  case "$SITE" in http*) URL="$SITE" ;; *) URL="https://$SITE" ;; esac
  cat > .env <<ENV
MIM_PG_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')
DOMAIN=$SITE
PUBLIC_URL=$URL
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
ENV
  chmod 600 .env
fi

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# nightly DB backup, keep 14 days
mkdir -p /opt/backups
cat > /etc/cron.d/mim-backup <<CRON
0 2 * * * root docker exec mim-postgres pg_dump -U postgres mim_erpdb 2>/dev/null | gzip > /opt/backups/mim_\$(date +\%F).sql.gz; find /opt/backups -mtime +14 -delete
CRON

echo; echo "=== DONE. Open: $SITE   login: admin / $(grep ADMIN_PASSWORD .env | cut -d= -f2)"

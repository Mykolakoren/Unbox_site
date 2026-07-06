#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# Deploy script — DigitalOcean Droplet (138.68.111.248).
#
# Frontend: build locally (Droplet has only 458 MB RAM, Vite build OOMs
#           there) → tar → scp → swap /var/www/unbox/dist with a dated
#           backup → nginx reload.
# Backend : git pull + systemctl restart unbox-api.service (reads code
#           from /var/www/unbox-beta/backend, not /var/www/unbox — yes
#           it's weird, yes that's how the Droplet is wired).
#
# Usage:
#   ./scripts/deploy.sh           # front + back
#   ./scripts/deploy.sh front     # only front
#   ./scripts/deploy.sh back      # only back
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

SSH_HOST="root@138.68.111.248"
SSH_KEY="${UNBOX_SSH_KEY:-$HOME/.ssh/unbox_droplet_ed25519}"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new $SSH_HOST"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

REMOTE_FRONT_DIR="/var/www/unbox/dist"
REMOTE_FRONT_SOURCES="/var/www/unbox-beta"   # build sources (node_modules live here)
REMOTE_BACK_DIR="/var/www/unbox/backend"     # systemd ExecStart uses this venv/path
REMOTE_BACK_MIRROR="/var/www/unbox-beta/backend"  # kept in sync via git pull
SERVICE_NAME="unbox-api.service"

MODE="${1:-all}"

cd "$(dirname "$0")/.."

banner() { echo; echo "═══ $* ═══"; }

deploy_front() {
  banner "FRONTEND build (local)"
  npm install --silent
  rm -rf dist
  npm run build

  banner "FRONTEND upload"
  local TARBALL="/tmp/unbox-dist-$(date +%s).tgz"
  tar czf "$TARBALL" -C dist .
  ls -lh "$TARBALL"

  $SCP "$TARBALL" "$SSH_HOST:/tmp/unbox-dist.tgz"
  rm -f "$TARBALL"

  banner "FRONTEND swap on Droplet"
  $SSH "set -e
    TS=\$(date +%Y%m%d-%H%M%S)
    mkdir -p /tmp/dist-new
    rm -rf /tmp/dist-new/*
    tar xzf /tmp/unbox-dist.tgz -C /tmp/dist-new
    echo 'new bundle:' \$(grep -o 'index-[A-Za-z0-9_-]*\.js' /tmp/dist-new/index.html | head -1)
    mv $REMOTE_FRONT_DIR $REMOTE_FRONT_DIR-backup-\$TS
    mv /tmp/dist-new $REMOTE_FRONT_DIR
    rm -f /tmp/unbox-dist.tgz
    # §5#8: битый nginx-конфиг → откат, не оставляем прод сломанным
    if ! nginx -t; then
      echo 'nginx -t FAILED — rolling back'
      rm -rf $REMOTE_FRONT_DIR; mv $REMOTE_FRONT_DIR-backup-\$TS $REMOTE_FRONT_DIR; exit 1
    fi
    systemctl reload nginx
    # §5#8 health-gate: сайт реально отдаёт 200? иначе авто-откат
    sleep 2
    CODE=\$(curl -s -o /dev/null -w '%{http_code}' https://unbox.com.ge/ || echo 000)
    if [ \"\$CODE\" != '200' ]; then
      echo \"health-check FAILED (HTTP \$CODE) — rolling back\"
      rm -rf $REMOTE_FRONT_DIR; mv $REMOTE_FRONT_DIR-backup-\$TS $REMOTE_FRONT_DIR
      systemctl reload nginx; exit 1
    fi
    echo \"health-check OK (200)\"
    echo 'installed bundle:' \$(grep -o 'index-[A-Za-z0-9_-]*\.js' $REMOTE_FRONT_DIR/index.html | head -1)
    # §5#8: прунинг старых бэкапов — оставляем 3 последних
    ls -dt $REMOTE_FRONT_DIR-backup-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
    echo 'dist-backups kept:' \$(ls -d $REMOTE_FRONT_DIR-backup-* 2>/dev/null | wc -l)
  "
}

deploy_back() {
  banner "BACKEND pull + restart"
  $SSH "set -e
    for dir in $REMOTE_BACK_DIR $REMOTE_BACK_MIRROR; do
      echo \"--- pulling \$dir\"
      cd \"\$dir\" && git fetch origin main 2>/dev/null && git checkout main 2>/dev/null || true
      git pull --ff-only origin main
    done
    echo '--- restart'
    systemctl restart $SERVICE_NAME
    sleep 4
    systemctl is-active $SERVICE_NAME
    echo '--- last 10 log lines'
    tail -10 /var/log/unbox.log
  "
}

case "$MODE" in
  front|frontend) deploy_front ;;
  back|backend)   deploy_back ;;
  all|"")         deploy_back; deploy_front ;;
  *)
    echo "unknown mode: $MODE"
    echo "usage: $0 [front|back|all]"
    exit 2
    ;;
esac

banner "done"

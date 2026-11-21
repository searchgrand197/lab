#!/usr/bin/env bash
# Pull latest code and fully refresh the running lab app on the VPS.
# Usage (as root):
#   bash /root/lab/update.sh

set -euo pipefail

if [[ "$(uname -s)" == "Linux" ]] && grep -q $'\r' "$0" 2>/dev/null; then
  tmp="$(mktemp)"
  tr -d '\r' < "$0" > "$tmp"
  exec bash "$tmp" "$@"
fi

APP_DIR="${APP_DIR:-/root/lab}"
SERVICE_NAME="${SERVICE_NAME:-lab}"

cd "${APP_DIR}"

echo "==> Git pull"
git fetch origin
git reset --hard origin/main
git clean -fd -e .venv -e .env -e db.sqlite3 -e media -e staticfiles -e logs -e frontend/node_modules -e frontend/dist

echo "==> HEAD is now: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

if [[ ! -d "${APP_DIR}/.venv" ]]; then
  python3 -m venv "${APP_DIR}/.venv"
fi
# shellcheck disable=SC1091
source "${APP_DIR}/.venv/bin/activate"
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q gunicorn

echo "==> Migrate + seed"
python manage.py migrate --noinput
python manage.py seed_lab || true
python manage.py collectstatic --noinput

echo "==> Rebuild frontend"
cd "${APP_DIR}/frontend"
rm -rf dist
npm ci || npm install
npm run build
if [[ ! -f dist/index.html ]]; then
  echo "ERROR: frontend build missing dist/index.html"
  exit 1
fi
cd "${APP_DIR}"

echo "==> Restart services"
systemctl restart "${SERVICE_NAME}"
systemctl reload nginx || systemctl restart nginx

sleep 1
systemctl --no-pager --full status "${SERVICE_NAME}" | sed -n '1,12p' || true

echo
echo "Update complete: https://lab.intvice.com"
echo "Hard-refresh browser (Ctrl+Shift+R) if the old UI is cached."

#!/usr/bin/env bash
# Full VPS refresh — pulls origin/main, rebuilds React, restarts Gunicorn+Nginx.
# Run as root:
#   cd /root/lab && git fetch origin && git reset --hard origin/main && bash update.sh

set -euo pipefail

if [[ "$(uname -s)" == "Linux" ]] && grep -q $'\r' "$0" 2>/dev/null; then
  tmp="$(mktemp)"
  tr -d '\r' < "$0" > "$tmp"
  chmod +x "$tmp"
  exec bash "$tmp" "$@"
fi

APP_DIR="${APP_DIR:-/root/lab}"
SERVICE_NAME="${SERVICE_NAME:-lab}"
EXPECTED_REMOTE="https://github.com/searchgrand197/lab.git"

cd "${APP_DIR}"

# deploy.sh may have chown'd the tree to www-data — that makes Git refuse root.
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
if [[ -d "${APP_DIR}/.git" ]]; then
  chown -R root:root "${APP_DIR}/.git" 2>/dev/null || true
fi

echo "==> Location: ${APP_DIR}"
echo "==> Remotes:"
git remote -v || true

# Ensure origin points at the correct repo
if ! git remote get-url origin 2>/dev/null | grep -q 'searchgrand197/lab'; then
  echo "==> Fixing origin remote -> ${EXPECTED_REMOTE}"
  git remote remove origin 2>/dev/null || true
  git remote add origin "${EXPECTED_REMOTE}"
fi

echo "==> Fetch + hard reset to origin/main"
git fetch origin --prune
git checkout -B main origin/main
git reset --hard origin/main
# Keep runtime data; wipe stale build artifacts
git clean -fd -e .venv -e .env -e db.sqlite3 -e db_demo.sqlite3 -e media -e staticfiles -e logs -e frontend/node_modules -e frontend/demo

HEAD_SHA="$(git rev-parse --short HEAD)"
HEAD_MSG="$(git log -1 --pretty=%s)"
echo "==> Code is now: ${HEAD_SHA} — ${HEAD_MSG}"

if [[ ! -f manage.py ]]; then
  echo "ERROR: manage.py missing in ${APP_DIR} — wrong folder?"
  exit 1
fi

echo "==> Python deps"
if [[ ! -d "${APP_DIR}/.venv" ]]; then
  python3 -m venv "${APP_DIR}/.venv"
fi
# shellcheck disable=SC1091
source "${APP_DIR}/.venv/bin/activate"
pip install -q --upgrade pip wheel
pip install -q -r requirements.txt
pip install -q gunicorn

echo "==> Django migrate / seed / static"
python manage.py migrate --noinput
python manage.py seed_lab || true
python manage.py migrate --database=demo --noinput || true
python manage.py seed_demo || true
mkdir -p media staticfiles logs static
python manage.py collectstatic --noinput

echo "==> Rebuild frontend (required — nginx serves frontend/dist)"
cd "${APP_DIR}/frontend"
rm -rf dist demo
rm -rf node_modules/.vite 2>/dev/null || true
npm ci || npm install
npm run build
npm run build:demo

if [[ ! -f "${APP_DIR}/frontend/dist/index.html" ]]; then
  echo "ERROR: frontend/dist/index.html missing after build"
  exit 1
fi
if [[ ! -f "${APP_DIR}/frontend/demo/index.html" ]]; then
  echo "ERROR: frontend/demo/index.html missing after demo build"
  exit 1
fi

ASSET_JS="$(grep -oE '/assets/[^"]+\.js' "${APP_DIR}/frontend/dist/index.html" | head -1 || true)"
echo "==> Built asset: ${ASSET_JS}"

# Prove new Widal UI is in the bundle
BUNDLE="$(find "${APP_DIR}/frontend/dist/assets" -name 'index-*.js' | head -1 || true)"
if [[ -n "${BUNDLE}" ]]; then
  if grep -q 'SALMONELLA TYPHI O' "${BUNDLE}"; then
    echo "==> OK: Widal matrix found in frontend bundle"
  else
    echo "ERROR: Frontend bundle is missing Widal changes — build is stale/wrong"
    exit 1
  fi
fi

# Permissions so nginx (www-data) can read dist under /root
if [[ "${APP_DIR}" == /root/* ]]; then
  chmod 711 /root
  chmod -R a+rX "${APP_DIR}/frontend/dist" "${APP_DIR}/frontend/demo" || true
  chmod a+x "${APP_DIR}" "${APP_DIR}/frontend" "${APP_DIR}/frontend/dist" "${APP_DIR}/frontend/demo" 2>/dev/null || true
fi

cd "${APP_DIR}"
chown -R www-data:www-data "${APP_DIR}/media" "${APP_DIR}/staticfiles" "${APP_DIR}/logs" 2>/dev/null || true
# Keep code readable; socket user needs traverse
chmod 755 "${APP_DIR}" 2>/dev/null || true

echo "==> Nginx site check / ensure /demo routes"
NGINX_SITE="/etc/nginx/sites-available/lab"
if [[ -f "${NGINX_SITE}" ]]; then
  if ! grep -q 'location /demo-api/' "${NGINX_SITE}"; then
    python3 - <<'PY'
from pathlib import Path
path = Path("/etc/nginx/sites-available/lab")
text = path.read_text()
snippet = """
    location /demo-api/ {
        proxy_pass http://lab_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location = /demo {
        return 301 /demo/;
    }

    location /demo/ {
        root /root/lab/frontend;
        try_files $uri $uri/ /demo/index.html;
    }
"""
    marker = "    location /api/"
    if marker in text and "location /demo-api/" not in text:
        text = text.replace(marker, snippet + "\n" + marker, 1)
        path.write_text(text)
        print("Inserted /demo and /demo-api nginx locations")
    else:
        print("Could not auto-patch nginx; add /demo locations manually")
PY
  fi
  grep -n "demo\|root\|proxy_pass\|lab.intvice" "${NGINX_SITE}" | head -50 || true
fi

echo "==> Restart lab + nginx"
systemctl restart "${SERVICE_NAME}"
nginx -t
systemctl reload nginx

sleep 2
if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
  echo "ERROR: ${SERVICE_NAME} failed"
  journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
  exit 1
fi

echo
echo "============================================"
echo " Updated to ${HEAD_SHA}"
echo " Frontend: ${ASSET_JS}"
echo " URL: https://lab.intvice.com"
echo " Demo: https://lab.intvice.com/demo/"
echo " Hard refresh: Ctrl+Shift+R"
echo "============================================"
echo "Verify from VPS:"
echo "  curl -s https://lab.intvice.com/ | head"
echo "  # JS name must match ${ASSET_JS}"

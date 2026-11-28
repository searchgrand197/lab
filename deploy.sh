#!/usr/bin/env bash
# One-shot Ubuntu deploy: Django (Gunicorn) + Vite React build + Nginx
# Domain: lab.intvice.com
# Target layout: /root/lab/manage.py
#
# On the VPS as root:
#   git clone https://github.com/searchgrand197/lab.git /root/lab
#   bash /root/lab/deploy.sh
#
# Optional:
#   EMAIL=you@example.com bash /root/lab/deploy.sh
#   SEED_DATA=0 bash /root/lab/deploy.sh

set -euo pipefail

# Survive CRLF if the file was edited on Windows
if [[ "$(uname -s)" == "Linux" ]] && grep -q $'\r' "$0" 2>/dev/null; then
  tmp="$(mktemp)"
  tr -d '\r' < "$0" > "$tmp"
  exec bash "$tmp" "$@"
fi

# Drop stale env from other deploys that would override defaults
case "${DOMAIN:-}" in
  *yourbrand*|*real100*|agro*) unset DOMAIN APP_NAME ;;
esac
case "${APP_NAME:-}" in
  yourbrand|real100agro) unset APP_NAME ;;
esac

DOMAIN="${DOMAIN:-lab.intvice.com}"
APP_NAME="${APP_NAME:-lab}"
APP_USER="${APP_USER:-www-data}"
EMAIL="${EMAIL:-admin@${DOMAIN}}"
WORKERS="${WORKERS:-$(( $(nproc) * 2 + 1 ))}"
SEED_DATA="${SEED_DATA:-1}"
PREFERRED_APP_DIR="/root/lab"

echo "==> Domain: ${DOMAIN}  (service: ${APP_NAME})"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: bash /root/lab/deploy.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Prefer /root/lab, else detect from script / cwd
if [[ -n "${APP_DIR:-}" ]]; then
  :
elif [[ -f "${PREFERRED_APP_DIR}/manage.py" && ( "${SCRIPT_DIR}" == "${PREFERRED_APP_DIR}" || "${SCRIPT_DIR}" == "/root/lab" ) ]]; then
  APP_DIR="${PREFERRED_APP_DIR}"
elif [[ -f "${SCRIPT_DIR}/manage.py" ]]; then
  APP_DIR="${SCRIPT_DIR}"
elif [[ -f "$(pwd)/manage.py" ]]; then
  APP_DIR="$(pwd)"
elif [[ -f "${PREFERRED_APP_DIR}/manage.py" ]]; then
  APP_DIR="${PREFERRED_APP_DIR}"
else
  echo "Could not find manage.py."
  echo "Expected: /root/lab/manage.py"
  echo "  git clone https://github.com/searchgrand197/lab.git /root/lab"
  echo "  bash /root/lab/deploy.sh"
  exit 1
fi

APP_DIR="$(cd "${APP_DIR}" && pwd)"
FRONTEND_DIR="${APP_DIR}/frontend"
FRONTEND_DIST="${FRONTEND_DIR}/dist"
VENV_DIR="${APP_DIR}/.venv"
ENV_FILE="${APP_DIR}/.env"
SOCKET_PATH="/run/${APP_NAME}/${APP_NAME}.sock"
SERVICE_NAME="${APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"

echo "==> App directory: ${APP_DIR}"

# /root is mode 700 by default — Nginx/www-data needs traverse
if [[ "${APP_DIR}" == /root/* ]]; then
  echo "==> Allowing Nginx/Gunicorn to traverse /root -> lab"
  chmod 711 /root
  chmod 755 /root/lab 2>/dev/null || true
  d="${APP_DIR}"
  while [[ "${d}" == /root/* && "${d}" != "/root" ]]; do
    chmod a+x "${d}" 2>/dev/null || true
    d="$(dirname "${d}")"
  done
fi

if [[ ! -f "${APP_DIR}/manage.py" ]]; then
  echo "manage.py not found in ${APP_DIR}"
  exit 1
fi

if [[ ! -f "${APP_DIR}/requirements.txt" ]]; then
  echo "requirements.txt not found in ${APP_DIR}"
  exit 1
fi

if [[ ! -f "${FRONTEND_DIR}/package.json" ]]; then
  echo "Frontend not found at ${FRONTEND_DIR}"
  echo "Expected: frontend/package.json (Vite React SPA)"
  exit 1
fi

id -u "${APP_USER}" >/dev/null 2>&1 || APP_USER="www-data"

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  python3 python3-venv python3-pip python3-dev \
  build-essential libsqlite3-dev \
  nginx curl ca-certificates gnupg \
  certbot python3-certbot-nginx \
  git

# Node.js 20 LTS for Vite build
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating Python venv + installing deps"
python3 -m venv "${VENV_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
pip install --upgrade pip wheel
pip install -r "${APP_DIR}/requirements.txt"
pip install gunicorn

if [[ ! -f "${ENV_FILE}" ]]; then
  SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"
  cat > "${ENV_FILE}" <<EOF
SECRET_KEY=${SECRET}
DEBUG=False
ALLOWED_HOSTS=${DOMAIN},www.${DOMAIN},127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN},http://${DOMAIN},http://www.${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
PUBLIC_BASE_URL=https://${DOMAIN}
EMAIL_HOST=smtpout.secureserver.net
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=support@intvice.com
EMAIL_HOST_PASSWORD='Nvn\$aroy001'
DEFAULT_FROM_EMAIL='Lab Software Demo <support@intvice.com>'
DEMO_LEAD_EMAIL_TO=support@intvice.com
DEMO_LEAD_EMAIL_CC=searchgrand@gmail.com
EOF
  echo "==> Wrote ${ENV_FILE}"
else
  echo "==> Using existing ${ENV_FILE}"
fi

mkdir -p "${APP_DIR}/media" "${APP_DIR}/staticfiles" "${APP_DIR}/logs" "${APP_DIR}/static"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

echo "==> Building React frontend (Vite)"
cd "${FRONTEND_DIR}"
# Vite 8 / Rolldown needs platform optional deps (@rolldown/binding-linux-x64-gnu).
# Never use --omit=optional. Clean install avoids Windows lockfile optional-dep bugs.
rm -rf node_modules
if ! npm ci; then
  echo "==> npm ci failed — refreshing lock + install"
  rm -rf node_modules package-lock.json
  npm install
fi
if ! npm run build; then
  echo "==> Build failed — reinstalling deps (Rolldown native binding fix)"
  rm -rf node_modules package-lock.json
  npm install
  npm run build
fi
npm run build:demo
if [[ ! -f "${FRONTEND_DIST}/index.html" ]]; then
  echo "Frontend build failed — missing ${FRONTEND_DIST}/index.html"
  exit 1
fi
if [[ ! -f "${FRONTEND_DIR}/demo/index.html" ]]; then
  echo "Demo frontend build failed — missing ${FRONTEND_DIR}/demo/index.html"
  exit 1
fi

echo "==> Django migrate + collectstatic"
cd "${APP_DIR}"
python manage.py migrate --noinput
python manage.py migrate --database=demo --noinput
python manage.py seed_demo || true
python manage.py collectstatic --noinput

if [[ "${SEED_DATA}" == "1" ]]; then
  if python manage.py help seed_lab >/dev/null 2>&1; then
    COUNT="$(python - <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "labproject.settings")
django.setup()
from lab.models import Test
print(Test.objects.count())
PY
)"
    if [[ "${COUNT}" == "0" ]]; then
      echo "==> Seeding lab catalog + admin user"
      python manage.py seed_lab || echo "WARN: seed_lab failed (continuing)"
    else
      echo "==> DB already has ${COUNT} tests — skip seed_lab"
    fi
  fi
fi

echo "==> Fixing ownership for ${APP_USER}"
# Keep .git owned by root so future git pull/update.sh works as root.
chown -R root:root "${APP_DIR}/.git" 2>/dev/null || true
git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
chown -R "${APP_USER}:${APP_USER}" \
  "${APP_DIR}/media" \
  "${APP_DIR}/staticfiles" \
  "${APP_DIR}/logs" \
  "${APP_DIR}/.venv" \
  "${APP_DIR}/frontend/dist" 2>/dev/null || true
# App code readable by service user; writable DB/media.
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chown -R root:root "${APP_DIR}/.git" 2>/dev/null || true
chmod 640 "${ENV_FILE}"
chown root:"${APP_USER}" "${ENV_FILE}"
chmod 775 "${APP_DIR}"
chmod 664 "${APP_DIR}/db.sqlite3" 2>/dev/null || true
# Allow nginx to read frontend build under /root
chmod 711 /root 2>/dev/null || true
chmod -R a+rX "${APP_DIR}/frontend/dist" "${APP_DIR}/frontend/demo" 2>/dev/null || true

echo "==> Writing Gunicorn systemd unit"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Gunicorn for ${APP_NAME} (${DOMAIN})
After=network.target

[Service]
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
RuntimeDirectory=${APP_NAME}
RuntimeDirectoryMode=0755
ExecStart=${VENV_DIR}/bin/gunicorn \\
  --workers ${WORKERS} \\
  --bind unix:${SOCKET_PATH} \\
  --access-logfile ${APP_DIR}/logs/gunicorn-access.log \\
  --error-logfile ${APP_DIR}/logs/gunicorn-error.log \\
  --timeout 120 \\
  labproject.wsgi:application
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "==> Writing Nginx site for ${DOMAIN}"
cat > "${NGINX_SITE}" <<EOF
upstream ${APP_NAME}_app {
    server unix:${SOCKET_PATH} fail_timeout=0;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 25M;

    root ${FRONTEND_DIST};
    index index.html;

    access_log /var/log/nginx/${APP_NAME}.access.log;
    error_log  /var/log/nginx/${APP_NAME}.error.log;

    location /api/ {
        proxy_pass http://${APP_NAME}_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location /demo-api/ {
        proxy_pass http://${APP_NAME}_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location /r/ {
        proxy_pass http://${APP_NAME}_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /admin/ {
        proxy_pass http://${APP_NAME}_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /static/ {
        alias ${APP_DIR}/staticfiles/;
        expires 7d;
        add_header Cache-Control "public";
    }

    location /media/ {
        alias ${APP_DIR}/media/;
        expires 7d;
        add_header Cache-Control "public";
    }

    location = /demo {
        return 301 /demo/;
    }

    location /demo/ {
        root ${APP_DIR}/frontend;
        try_files \$uri \$uri/ /demo/index.html;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sfn "${NGINX_SITE}" "/etc/nginx/sites-enabled/${APP_NAME}"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "==> Opening firewall for Nginx"
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || true
fi

echo "==> Starting services"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 2

if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
  echo "ERROR: ${SERVICE_NAME} failed to start"
  journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
  exit 1
fi

nginx -t
systemctl reload nginx

echo "==> Attempting Let's Encrypt SSL (DNS A record for ${DOMAIN} must point here)"
# Only request certs for hostnames that resolve (www often has no DNS yet).
CERTBOT_DOMAINS=(-d "${DOMAIN}")
if getent hosts "www.${DOMAIN}" >/dev/null 2>&1 || host "www.${DOMAIN}" >/dev/null 2>&1; then
  CERTBOT_DOMAINS+=(-d "www.${DOMAIN}")
else
  echo "==> Skipping www.${DOMAIN} (no DNS A/AAAA record)"
fi
if certbot --nginx \
    "${CERTBOT_DOMAINS[@]}" \
    --expand \
    --non-interactive --agree-tos -m "${EMAIL}" --redirect; then
  echo "SSL enabled: https://${DOMAIN}"
else
  echo "WARN: Certbot failed (DNS not ready yet?). Site is on http://${DOMAIN}"
  echo "Later run:"
  echo "  certbot --nginx -d ${DOMAIN} -m ${EMAIL} --agree-tos --non-interactive --redirect"
fi

systemctl restart "${SERVICE_NAME}"
systemctl reload nginx

echo
echo "============================================"
echo " Deploy complete"
echo " URL:     https://${DOMAIN}"
echo " API:     /api/"
echo " Django:  /admin/"
echo " Share:   /r/<token>/"
echo " App:     ${APP_DIR}"
echo " Env:     ${ENV_FILE}"
echo " Logs:    ${APP_DIR}/logs/"
echo " Status:  systemctl status ${SERVICE_NAME}"
echo "============================================"
echo "Install path: /root/lab/manage.py"
echo "Clone + deploy:"
echo "  git clone https://github.com/searchgrand197/lab.git /root/lab"
echo "  bash /root/lab/deploy.sh"
echo "Fill secrets in ${ENV_FILE}, then: systemctl restart ${SERVICE_NAME}"

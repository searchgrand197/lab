"""
Django settings for Khalsa Clinical Laboratory.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name, default=''):
    return os.environ.get(name, default).strip()


def _env_list(name, default=''):
    raw = _env(name, default)
    return [p.strip() for p in raw.split(',') if p.strip()]


SECRET_KEY = _env('SECRET_KEY', 'django-insecure-x8$kvo08p(s1%^k!(23+e!()(o2$%*7b^g*np%@4v^6+^odp_r')

DEBUG = _env('DEBUG', 'True').lower() in ('1', 'true', 'yes', 'on')

ALLOWED_HOSTS = _env_list('ALLOWED_HOSTS', '*') if DEBUG else _env_list(
    'ALLOWED_HOSTS',
    'lab.intvice.com,www.lab.intvice.com,localhost,127.0.0.1',
)
if DEBUG and ALLOWED_HOSTS == ['*']:
    ALLOWED_HOSTS = ['*']

# Used in report QR codes when Print Settings has no public base URL.
PUBLIC_BASE_URL = _env('PUBLIC_BASE_URL', '')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'accounts',
    'lab',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'lab.middleware.DemoDatabaseMiddleware',
]

# Vite may pick 5173–5180 when a port is already in use (local).
_CORS_PORTS = range(5173, 5181)
_LOCAL_CORS = [
    origin
    for port in _CORS_PORTS
    for origin in (f'http://localhost:{port}', f'http://127.0.0.1:{port}')
]
_PROD_CORS = _env_list(
    'CORS_ALLOWED_ORIGINS',
    'https://lab.intvice.com,https://www.lab.intvice.com',
)
CORS_ALLOWED_ORIGINS = list(dict.fromkeys(_LOCAL_CORS + _PROD_CORS))
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = list(
    dict.fromkeys(
        _LOCAL_CORS
        + _env_list(
            'CSRF_TRUSTED_ORIGINS',
            'https://lab.intvice.com,https://www.lab.intvice.com',
        )
    )
)
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_HTTPONLY = True

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

ROOT_URLCONF = 'labproject.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'labproject.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    },
    # Isolated try-out at /demo — never shares patients/bookings with production.
    'demo': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db_demo.sqlite3',
    },
}

DATABASE_ROUTERS = ['lab.db.DemoRouter']

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
_STATIC_DIR = BASE_DIR / 'static'
STATICFILES_DIRS = [_STATIC_DIR] if _STATIC_DIR.exists() else []
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

LOGIN_URL = 'accounts:login'
LOGIN_REDIRECT_URL = 'lab:patients'
LOGOUT_REDIRECT_URL = 'accounts:login'

LAB_NAME = 'Khalsa Clinical Laboratory'

# Demo lead notification email (credentials from environment / VPS .env).
EMAIL_HOST = _env('EMAIL_HOST', 'smtpout.secureserver.net')
EMAIL_PORT = int(_env('EMAIL_PORT', '587') or '587')
EMAIL_USE_TLS = _env('EMAIL_USE_TLS', 'True').lower() in ('1', 'true', 'yes', 'on')
EMAIL_HOST_USER = _env('EMAIL_HOST_USER', 'support@intvice.com')
EMAIL_HOST_PASSWORD = _env('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = _env(
    'DEFAULT_FROM_EMAIL',
    "Goel's Dental Clinic <support@intvice.com>",
)
DEMO_LEAD_EMAIL_TO = _env('DEMO_LEAD_EMAIL_TO', 'support@intvice.com')
DEMO_LEAD_EMAIL_CC = _env('DEMO_LEAD_EMAIL_CC', 'searchgrand@gmail.com')

# Allow the mobile/report share page to embed the PDF in an iframe.
X_FRAME_OPTIONS = 'SAMEORIGIN'

# Khalsa Clinical Laboratory

Django API + React (Vite) UI for lab bookings, masters, and PDF reports.

## Stack
- **Backend:** Django 5 + SQLite + ReportLab (`/api/...`)
- **Frontend:** React + Vite + React Router (`frontend/`)

## Setup

```bash
cd "khalsa Lab"
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_lab
```

```bash
cd frontend
npm install
```

## Run (two terminals)

**API (Django)**
```bash
python manage.py runserver
```

**UI (React)**
```bash
cd frontend
npm run dev
```

Open **http://127.0.0.1:5173**

Login: `admin` / `admin123`

Vite proxies `/api` to Django on port 8000.

## Features
- Smooth SPA navigation
- Interactive login
- Patients search
- Book Test → report popup (left tests / right results)
- Doctors, Categories, Tests
- PDF reports

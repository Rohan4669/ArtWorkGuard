# ArtworkGuard

Packaging artwork comparison and verification. Compare the client's **original** PDF with the designer's **revised** PDF,
review highlighted differences, and keep a downloadable report plus a reviewer decision record.

> **Not commercially cleared.** See [docs/LICENCES.md](docs/LICENCES.md) for open licence-review items.
> **Never** treat "no differences detected" as "artwork is error-free" — see *Limitations*.

The app name is configurable (`APP_NAME` in `backend/.env`).

## Requirements

| | Version | Notes |
|---|---|---|
| Node.js | **22.12+** | scripts use `node --env-file-if-exists` |
| Python | **3.10+** (3.12 tested) | only for the visual-diff worker |
| MongoDB | 6.x or 7.x | local install or Atlas |

**macOS:** `brew install node python@3.12` and `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`
**Windows:** install Node LTS and Python 3.12 from nodejs.org / python.org (tick *Add Python to PATH*), and MongoDB Community Server (as a service) from mongodb.com. Use PowerShell.

## Install

```bash
npm install                      # all JS dependencies (root, backend, frontend workspaces)
npm run setup:engine             # creates engine/.venv and installs engine/requirements.txt
npm run setup:engine -- --dev    # same, plus ReportLab (needed only to run the backend tests)
cp .env.example backend/.env     # Windows: copy .env.example backend\.env
```

Edit `backend/.env`: set `JWT_SECRET` (32+ random chars) and, on Windows, `PYTHON_BIN=..\engine\.venv\Scripts\python.exe`.
Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

## Run

```bash
npm run dev          # API on :4000 and web UI on http://localhost:5173 (Vite proxies /api)
```
Open http://localhost:5173 and register. **The first account created becomes the administrator.**
Set `ALLOW_REGISTRATION=false` afterwards to close sign-up.

Production-style, single process (API + built UI): `npm run build`, then set `SERVE_FRONTEND=true NODE_ENV=production`
(with `JWT_SECRET`, `COOKIE_SECURE`/HTTPS) and run `npm start`. Put it behind an HTTPS reverse proxy.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | development / production start |
| `npm run build` | production frontend build (`frontend/dist`) |
| `npm run lint` | ESLint for backend and frontend |
| `npm test` | backend (49 tests) + frontend (11 tests) |
| `npm run check` | lint + tests + build + licence inventory |
| `npm run licences` | list production dependency licences (not legal advice) |
| `npm run engine:eval -w backend` | run the engine over generated PDF pairs |
| `npm run user:reset-password -w backend -- user@example.com` | admin password reset (there is no email recovery) |

### Tests
Backend tests need a MongoDB-protocol server and the dev engine venv (`npm run setup:engine -- --dev`). They use a
throwaway database per suite on `mongodb://127.0.0.1:27017` (override with `TEST_MONGODB_URI`) and drop it afterwards.
The tests were developed against FerretDB 1.24 (SQLite); **run them against your real MongoDB before relying on them.**

## How it works

`Express API ─ Mongoose ─ MongoDB` · uploads validated by content, stored under generated names outside any web root ·
jobs queued in MongoDB and run by an in-process worker pool · per job: **PDF.js** extracts words and boxes, pages are
aligned by content similarity, words are diffed; a **Python worker** (PDFium render + OpenCV pixel diff) finds visual
changes; a PDF report is generated; the reviewer records a decision.

* Uploads: `backend/storage/uploads` (read-only files, UUID names) · Reports: `storage/reports` · Page images: `storage/pages` · Temp: `storage/tmp`. Change with `UPLOAD_DIR`, `REPORT_DIR`, … Files are only served through authenticated, ownership-checked endpoints.
* `RETENTION_DAYS=N` deletes comparisons, reports and unused uploads older than N days.
* Engine is swappable: implement `backend/src/engines/engine.interface.js` and register it in `backend/src/server.js`.

## Limitations (also shown in the app)

* Compares extractable text and the rendered look of aligned pages. It is an aid to human proofing.
* **Not verified:** CMYK/spot-colour values, overprint, barcode correctness, dielines/bleed/trim, font substitution.
* Scanned or outlined artwork has no text layer: no text is read; only pixel differences are shown.
* Faint changes (≈3% tint) are only found at `VISUAL_SENSITIVITY=high`; high may add noise on photographic art.
* Report PDFs use Latin-1 fonts: other scripts print as "¿" in the PDF (the on-screen results are exact).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Job fails with `ENGINE_DEPENDENCY_MISSING` | `npm run setup:engine`; check `PYTHON_BIN` points inside `engine/.venv` |
| `ENGINE_TIMEOUT` | raise `COMPARISON_TIMEOUT_MS`; large/complex pages can be slow |
| Upload rejected `PDF_ENCRYPTED` / `PDF_CORRUPT` | export an unprotected / re-exported PDF |
| `Invalid environment configuration` at start | the message names the variable; compare with `.env.example` |
| Cannot sign in after restart (dev) | `JWT_SECRET` unset → ephemeral secret; set it |
| Mac/Windows: `python3` not found | set `PYTHON=/full/path/to/python` when running `npm run setup:engine` |
| Browser shows API errors in dev | ensure API is on :4000 and `FRONTEND_ORIGIN` matches the UI origin |

## Not implemented / deferred

Email password recovery (needs an SMTP provider) · persistent Python worker · external queue (BullMQ/SQS) ·
S3 storage adapter · OCR, barcode, spot-colour and preflight modules · Unicode report fonts · browser end-to-end tests.

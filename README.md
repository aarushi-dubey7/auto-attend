# Auto-Attend

Phase-1 prototype for Chromebook attendance using Web Bluetooth + Supabase, deployed as a static site on GitHub Pages.

## Current Scope

- Web app with one `Check In` button.
- Scan for teacher beacon service UUID `0000181c-0000-1000-8000-00805f9b34fb`.
- Ask Supabase if student email is scheduled for that UUID right now.
- If scheduled, insert attendance row into `attendance_log`.
- No FastAPI in this phase.

## Project Layout

- `docs/index.html`: GitHub Pages UI.
- `docs/styles.css`: Page styling.
- `docs/app.js`: Web Bluetooth + Supabase check-in logic.
- `backend/sql/supabase_schema.sql`: SQL for `student_schedule` and `attendance_log`.

## Supabase Setup

1. Open Supabase SQL Editor and run `backend/sql/supabase_schema.sql`.
2. Confirm both tables exist: `student_schedule`, `attendance_log`.
3. Insert or edit schedule rows so active class windows match your local time.
4. In Supabase API settings, add your GitHub Pages origin to CORS allowed origins:
	- `https://<your-github-username>.github.io`
	- If repo pages path is required, still add only origin (no path).

## Local Run (Quick Test)

From repo root:

```bash
python3 -m http.server 5500 --directory docs
```

Then open `http://localhost:5500`.

## GitHub Pages Deployment

1. Push this repository to GitHub.
2. In GitHub repo settings, open Pages.
3. Set source to `Deploy from a branch`.
4. Select branch `main` and folder `/docs`.
5. Save and wait for GitHub Pages URL to be published.

## Runtime Inputs (On the Page)

Enter these in the app UI before check-in:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- Schedule table name (default `student_schedule`)
- Attendance table name (default `attendance_log`)
- Student email

## Security Notes

- Do not commit a Supabase service role key.
- For this web prototype, use only publishable/anon key and strict RLS policies.
- If you later add backend APIs, move sensitive logic and keys server-side.
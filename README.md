# Faculty Scheduler Pro

A premium, glassmorphism-styled faculty timetable portal: HOD uploads an
Excel timetable, the system parses it, faculty get individual logins and
instantly see their current/next class, room, and full schedule.

This is a **working scaffold**, not a hosted app — you run it yourself
(instructions below). It was built and validated against a real timetable
export (`24_Batch_III-I_FINAL_TIME_TABLE.xlsx`), so the parser logic isn't
guesswork; the frontend mock data is drawn from that same real file so the
UI you see reflects actual data shape.

## What's real vs. what's scaffolded

| Piece | Status |
|---|---|
| DB schema + migrations | Complete, ready to run |
| Excel parser (structure extraction) | Complete, validated against your real file |
| Subject-code → faculty fuzzy matcher | Complete, with confidence scoring — see note below |
| JWT auth, roles, password reset | Complete |
| Faculty routes (today/week/export) | Complete |
| HOD routes (stats, faculty mgmt, class views) | Complete |
| Excel export (ExcelJS) | Complete |
| Frontend design system (glass cards, hero, timeline, week strip) | Complete |
| Faculty Dashboard | Complete, wired to **mock data** |
| HOD Dashboard | Complete, wired to **mock data** |
| Frontend ↔ backend wiring (TanStack Query hooks) | Scaffolded (`lib/api.ts` ready) — swap mock imports for real queries once your DB is running |
| PDF export | Not built yet (Excel export is; PDF is a straightforward addition using the same data, e.g. with `puppeteer` or `pdfkit`) |
| Push/browser notifications ("15 min before class") | Not built yet — needs a scheduler (cron or a lightweight worker) checking upcoming periods |
| Monthly calendar view | Not built yet |
| AWS S3 migration for uploads | Not built — currently local disk storage in `backend/uploads/`, swap `multer.diskStorage` for `multer-s3` when ready |

**On the Excel parser specifically:** your real timetable file uses short
codes in the day grid (`CC`, `ICS`, `ATCD`) but full names in the legend
table (`Cloud Computing`, `Introduction to Cyber Security`...), and the
abbreviation rule isn't consistent across sheets — sometimes it's initials,
sometimes a lab is spelled out in full ("FLUTTER LAB" vs "CC LAB"). There is
no deterministic rule that gets 100% of these right for every college's
format. So the parser does structural extraction deterministically and
subject-matching with a **confidence score** — matches above threshold
auto-apply, everything else surfaces in an upload-review screen for the HOD
to confirm with one click. That review step is a real feature, not a
workaround: build it as a modal/page in the frontend that lists
`mappingSuggestions` from the `/api/uploads` response and lets the HOD pick
from `alternatives` for any low-confidence code.

## Project structure

```
faculty-scheduler-pro/
├── backend/                  Express + TypeScript API
│   ├── src/
│   │   ├── db/migrations/    SQL schema (run with `npm run migrate`)
│   │   ├── services/
│   │   │   ├── excelParser.ts        ← the core parsing engine
│   │   │   ├── timetableGenerator.ts ← turns parsed data into DB rows
│   │   │   └── excelExport.ts        ← ExcelJS download generator
│   │   ├── routes/            auth, uploads, faculty, hod
│   │   └── scripts/           testParse.ts, seedHod.ts
│   └── .env.example
└── frontend/                  React + Vite + Tailwind + Framer Motion
    └── src/
        ├── components/        GlassCard, HeroCard, DayTimeline, WeekStrip, AppHeader
        ├── pages/              Login, FacultyDashboard, HODDashboard
        └── lib/mockData.ts     Demo data derived from your real uploaded file
```

## Running it locally

### 1. Database

You need a Postgres instance (local install, Docker, or a hosted free tier
like Supabase/Neon/Railway).

```bash
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL to your Postgres connection string
npm install
npm run migrate
npm run seed:hod -- hod@yourcollege.edu YourPassword123
```

### 2. Test the parser against your real file

```bash
npm run parse:test -- /path/to/24_Batch_III-I_FINAL_TIME_TABLE.xlsx
```

This prints the detected blocks, legend, and any low-confidence subject
mappings — use this to sanity-check before wiring up the review UI.

### 3. Start the backend

```bash
npm run dev
# API on http://localhost:4000
```

### 4. Start the frontend

```bash
cd ../frontend
npm install
npm run dev
# App on http://localhost:5173
```

By default the frontend routes (`/`, `/dashboard`, `/hod`) show mock data so
you can see the full UI immediately without the backend running. To wire up
real data:

1. In `pages/FacultyDashboard.tsx` and `HODDashboard.tsx`, replace the
   `mockData` imports with TanStack Query hooks calling `lib/api.ts`
   (e.g. `useQuery(['schedule-today'], () => api.get('/faculty/schedule/today'))`).
2. Point `VITE_API_URL` in a `frontend/.env` at your backend if not on
   `localhost:4000`.

## Next build priorities (suggested order)

1. **Upload review screen** — the mapping-confidence UI described above;
   this is what makes the "automatic" parsing trustworthy in production.
2. **Wire dashboards to real API** — swap mock imports for TanStack Query.
2. **Monthly calendar** view for faculty.
3. **Notifications** — a small cron job (e.g. `node-cron`) that checks
   `schedules` every minute and pushes a browser notification 15 min before
   each period.
4. **PDF export** — reuse the same query as `excelExport.ts`, render with
   `pdfkit` or `puppeteer` + an HTML template for pixel-perfect layout.
5. **S3 migration** — swap `multer.diskStorage` for `multer-s3` in
   `upload.routes.ts`; no schema changes needed since `storage_path` is
   already just a string.

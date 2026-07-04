-- Faculty Scheduler Pro — Initial Schema
-- Run with: npm run migrate  (reads DATABASE_URL from .env)

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

CREATE TABLE departments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,          -- e.g. "CSE (Cyber Security)"
  short_code    TEXT NOT NULL UNIQUE,          -- e.g. "CS"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number   TEXT NOT NULL UNIQUE,          -- e.g. "3305", "1206"
  room_type     TEXT NOT NULL DEFAULT 'classroom', -- classroom | lab | seminar
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE classes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- e.g. "III-I (CS) - CREAM"
  year          TEXT,                          -- e.g. "III Year I Semester"
  section       TEXT,                          -- e.g. "CREAM" / "GENERAL" / "A" / "B"
  academic_year TEXT,                          -- e.g. "2026-27"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE TABLE subjects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,                 -- "Cloud Computing"
  short_code    TEXT NOT NULL,                 -- "CC" (as seen in the excel grid)
  is_lab        BOOLEAN NOT NULL DEFAULT false,
  default_room  TEXT,                          -- room hint parsed from legend, if any
  UNIQUE (department_id, short_code)
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('hod', 'faculty')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  must_reset_password BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE faculty (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,                 -- "Mr.A.Veema Rao" as it appears in excel
  display_name  TEXT,                          -- cleaned display version, e.g. "A. Veema Rao"
  designation   TEXT,                          -- "Assistant Professor" etc (optional, editable)
  phone         TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE time_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL,                 -- "09.10-10.00"
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  slot_order    INT NOT NULL,                  -- ordering within a day
  is_break      BOOLEAN NOT NULL DEFAULT false, -- BREAK / LUNCH rows
  UNIQUE (label)
);

CREATE TABLE uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  sheet_count   INT,
  status        TEXT NOT NULL DEFAULT 'pending_review'
                CHECK (status IN ('pending_review','processing','applied','failed')),
  parse_summary JSONB,                          -- counts, warnings, low-confidence mappings
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row = one period, for one class-section, on one weekday, in one uploaded timetable version
CREATE TABLE schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id    UUID REFERENCES subjects(id) ON DELETE SET NULL,
  faculty_id    UUID REFERENCES faculty(id) ON DELETE SET NULL,
  room_id       UUID REFERENCES rooms(id) ON DELETE SET NULL,
  time_slot_id  UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  day_of_week   TEXT NOT NULL CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  raw_label     TEXT,
  upload_id     UUID REFERENCES uploads(id) ON DELETE SET NULL,
  effective_from DATE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,                 -- "UPLOAD_APPLIED", "FACULTY_DISABLED", etc
  meta          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the lookups the dashboard needs constantly
CREATE INDEX idx_schedules_faculty_day ON schedules(faculty_id, day_of_week) WHERE is_active;
CREATE INDEX idx_schedules_class_day   ON schedules(class_id, day_of_week) WHERE is_active;
CREATE INDEX idx_schedules_timeslot    ON schedules(time_slot_id);
CREATE INDEX idx_faculty_department    ON faculty(department_id);

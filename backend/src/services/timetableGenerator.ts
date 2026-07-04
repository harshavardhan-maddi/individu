/**
 * Takes the structural output of excelParser.ts, plus the HOD's confirmed
 * code -> subject/faculty mappings (any auto-suggestion the HOD accepted or
 * corrected in the review screen), and materializes it into the database:
 * departments, classes, subjects, faculty (+ user accounts), rooms,
 * time_slots, and schedules.
 *
 * Idempotent-ish: re-running an upload for the same class supersedes the
 * previous active schedules for that class (sets is_active = false) rather
 * than duplicating rows, so re-uploads after a timetable revision work
 * cleanly.
 */
import { PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { ParsedSheet, ParsedBlock } from "./excelParser.js";

export interface ConfirmedMapping {
  code: string;
  subjectFullName: string;
  facultyName: string;
  isLab: boolean;
  roomHint: string | null;
}

interface ApplyOptions {
  uploadId: string;
  uploadedByUserId: string;
  departmentShortCode: string; // HOD picks/confirms this per sheet in the review UI
  departmentFullName: string;
  mappingsByCode: Map<string, ConfirmedMapping>; // resolved per-sheet mapping table
}

async function upsertDepartment(client: PoolClient, shortCode: string, fullName: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO departments (name, short_code) VALUES ($1, $2)
     ON CONFLICT (short_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [fullName, shortCode]
  );
  return rows[0].id;
}

async function upsertRoom(client: PoolClient, roomNumber: string | null): Promise<string | null> {
  if (!roomNumber) return null;
  const { rows } = await client.query(
    `INSERT INTO rooms (room_number) VALUES ($1)
     ON CONFLICT (room_number) DO UPDATE SET room_number = EXCLUDED.room_number
     RETURNING id`,
    [roomNumber]
  );
  return rows[0].id;
}

async function upsertTimeSlot(
  client: PoolClient,
  label: string,
  startTime: string,
  endTime: string,
  isBreak: boolean,
  order: number
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO time_slots (label, start_time, end_time, slot_order, is_break)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (label) DO UPDATE SET slot_order = EXCLUDED.slot_order
     RETURNING id`,
    [label, startTime, endTime, order, isBreak]
  );
  return rows[0].id;
}

async function upsertClass(
  client: PoolClient,
  departmentId: string,
  classLabel: string,
  classTitle: string | null
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO classes (department_id, name, year)
     VALUES ($1, $2, $3)
     ON CONFLICT (department_id, name) DO UPDATE SET year = EXCLUDED.year
     RETURNING id`,
    [departmentId, classLabel, classTitle]
  );
  return rows[0].id;
}

async function upsertSubject(
  client: PoolClient,
  departmentId: string,
  code: string,
  mapping: ConfirmedMapping | undefined
): Promise<string> {
  const fullName = mapping?.subjectFullName ?? code;
  const isLab = mapping?.isLab ?? code.toUpperCase().includes("LAB");
  const { rows } = await client.query(
    `INSERT INTO subjects (department_id, full_name, short_code, is_lab, default_room)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (department_id, short_code) DO UPDATE
       SET full_name = EXCLUDED.full_name, is_lab = EXCLUDED.is_lab
     RETURNING id`,
    [departmentId, fullName, code, isLab, mapping?.roomHint ?? null]
  );
  return rows[0].id;
}

function cleanFacultyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(mr|mrs|dr|ms)\.?\s+/i, "")
    .replace(/^(mr|mrs|dr|ms)\.?/i, "")
    .replace(/[^a-z]/g, "")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function isNameSimilar(nameA: string, nameB: string): boolean {
  const cleanA = cleanFacultyName(nameA);
  const cleanB = cleanFacultyName(nameB);
  
  if (cleanA === cleanB) return true;
  if (cleanA.length < 4 || cleanB.length < 4) return false;

  if (cleanB.startsWith(cleanA) && cleanA.length >= 6) return true;
  if (cleanA.startsWith(cleanB) && cleanB.length >= 6) return true;

  const dist = levenshtein(cleanA, cleanB);
  if (dist <= 2 && cleanA[0] === cleanB[0] && cleanA[1] === cleanB[1]) {
    return true;
  }
  
  return false;
}

/** Faculty accounts are created lazily on first sighting in a timetable.
 *  Default password is a random temp string; must_reset_password forces
 *  them to set their own on first login. Email is a deterministic slug —
 *  the HOD can correct it later in Faculty Management. */
async function upsertFacultyWithAccount(
  client: PoolClient,
  fullName: string,
  departmentId: string
): Promise<{ id: string; existedBefore: boolean }> {
  const trimmedName = fullName.trim();
  
  // Find similar existing faculty member to prevent duplicates
  const allFacs = await client.query(`SELECT id, full_name FROM faculty`);
  for (const fac of allFacs.rows) {
    if (isNameSimilar(trimmedName, fac.full_name)) {
      return { id: fac.id, existedBefore: true };
    }
  }

  const slug = trimmedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  // Generate a unique email that does not exist in the users table
  let email = `${slug}@faculty.scheduler.local`;
  let userExists = true;
  let attempts = 0;
  while (userExists && attempts < 20) {
    const check = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (check.rows.length === 0) {
      userExists = false;
    } else {
      const randomSuffix = Math.random().toString(36).slice(2, 6);
      email = `${slug}.${randomSuffix}@faculty.scheduler.local`;
    }
    attempts++;
  }

  const tempPassword = Math.random().toString(36).slice(2, 10);
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role, must_reset_password)
     VALUES ($1, $2, 'faculty', true)
     RETURNING id`,
    [email, passwordHash]
  );
  const userId = userRes.rows[0].id;

  const facultyRes = await client.query(
    `INSERT INTO faculty (user_id, department_id, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, departmentId, trimmedName]
  );
  return { id: facultyRes.rows[0].id, existedBefore: false };
}

async function applyBlock(
  client: PoolClient,
  block: ParsedBlock,
  opts: ApplyOptions,
  departmentId: string
) {
  const classId = await upsertClass(client, departmentId, block.classLabel, block.classLabel);
  const roomFallbackId = await upsertRoom(client, block.roomNumber);

  const timeSlotIds: string[] = [];
  for (let idx = 0; idx < block.periods.length; idx++) {
    const p = block.periods[idx];
    const id = await upsertTimeSlot(
      client,
      p.label,
      p.startTime,
      p.endTime,
      p.isBreak,
      idx
    );
    timeSlotIds.push(id);
  }

  // Supersede previous active schedules for this class before inserting fresh ones.
  await client.query(`UPDATE schedules SET is_active = false WHERE class_id = $1 AND is_active`, [classId]);

  for (const cell of block.cells) {
    if (
      cell.isBreak ||
      !cell.code ||
      /^(VERBAL|APTITUDE|TECHNICAL)/i.test(cell.code)
    ) {
      continue;
    }

    const mapping = opts.mappingsByCode.get(cell.code);
    const subjectId = await upsertSubject(client, departmentId, cell.code, mapping);
    
    let facultyId: string | null = null;
    let existedBefore = false;
    if (mapping) {
      const res = await upsertFacultyWithAccount(client, mapping.facultyName, departmentId);
      facultyId = res.id;
      existedBefore = res.existedBefore;
    }
    
    const roomId = existedBefore
      ? null
      : (mapping?.roomHint ? await upsertRoom(client, mapping.roomHint) : roomFallbackId);
      
    const timeSlotId = timeSlotIds[cell.periodIndex];

    await client.query(
      `INSERT INTO schedules
         (class_id, subject_id, faculty_id, room_id, time_slot_id, day_of_week, raw_label, upload_id, effective_from, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [
        classId,
        subjectId,
        facultyId,
        roomId,
        timeSlotId,
        cell.dayOfWeek,
        cell.rawLabel,
        opts.uploadId,
        block.effectiveFrom,
      ]
    );
  }
}

export async function applyParsedSheet(sheet: ParsedSheet, opts: ApplyOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const departmentId = await upsertDepartment(client, opts.departmentShortCode, opts.departmentFullName);
    for (const block of sheet.blocks) {
      await applyBlock(client, block, opts, departmentId);
    }
    await client.query(`UPDATE uploads SET status = 'applied' WHERE id = $1`, [opts.uploadId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

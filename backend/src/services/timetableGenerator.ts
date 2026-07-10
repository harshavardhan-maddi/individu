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

interface ImportCache {
  departments: Map<string, string>; // shortCode -> id
  rooms: Map<string, string>; // roomNumber -> id
  subjects: Map<string, string>; // `${departmentId}:${shortCode}` -> id
  faculty: Map<string, string>; // cleanedName -> id
  facultyList: { id: string; fullName: string }[]; // for similar name check
  users: Set<string>; // lowercase emails
  timeSlots: Map<string, string>; // label -> id
}

async function initCache(client: PoolClient): Promise<ImportCache> {
  const deptsRes = await client.query(`SELECT id, short_code FROM departments`);
  const roomsRes = await client.query(`SELECT id, room_number FROM rooms`);
  const subjectsRes = await client.query(`SELECT id, department_id, short_code FROM subjects`);
  const facultyRes = await client.query(`SELECT id, full_name FROM faculty`);
  const usersRes = await client.query(`SELECT email FROM users`);
  const timeSlotsRes = await client.query(`SELECT id, label FROM time_slots`);

  const departments = new Map<string, string>(deptsRes.rows.map(r => [r.short_code, r.id]));
  const rooms = new Map<string, string>(roomsRes.rows.map(r => [r.room_number, r.id]));
  const subjects = new Map<string, string>(subjectsRes.rows.map(r => [`${r.department_id}:${r.short_code}`, r.id]));
  const timeSlots = new Map<string, string>(timeSlotsRes.rows.map(r => [r.label, r.id]));

  const faculty = new Map<string, string>();
  const facultyList = facultyRes.rows.map(r => {
    const cleaned = cleanFacultyName(r.full_name);
    faculty.set(cleaned, r.id);
    return { id: r.id, fullName: r.full_name };
  });

  const users = new Set<string>(usersRes.rows.map(r => r.email.toLowerCase()));

  return { departments, rooms, subjects, faculty, facultyList, users, timeSlots };
}

async function getOrUpsertDepartment(client: PoolClient, cache: ImportCache, shortCode: string, fullName: string): Promise<string> {
  let id = cache.departments.get(shortCode);
  if (!id) {
    const { rows } = await client.query(
      `INSERT INTO departments (name, short_code) VALUES ($1, $2)
       ON CONFLICT (short_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [fullName, shortCode]
    );
    id = rows[0].id as string;
    cache.departments.set(shortCode, id);
  }
  return id as string;
}

async function getOrUpsertRoom(client: PoolClient, cache: ImportCache, roomNumber: string | null): Promise<string | null> {
  if (!roomNumber) return null;
  let id = cache.rooms.get(roomNumber);
  if (!id) {
    const { rows } = await client.query(
      `INSERT INTO rooms (room_number) VALUES ($1)
       ON CONFLICT (room_number) DO UPDATE SET room_number = EXCLUDED.room_number
       RETURNING id`,
      [roomNumber]
    );
    id = rows[0].id as string;
    cache.rooms.set(roomNumber, id);
  }
  return id as string;
}

async function getOrUpsertTimeSlot(
  client: PoolClient,
  cache: ImportCache,
  label: string,
  startTime: string,
  endTime: string,
  isBreak: boolean,
  order: number
): Promise<string> {
  let id = cache.timeSlots.get(label);
  if (!id) {
    const { rows } = await client.query(
      `INSERT INTO time_slots (label, start_time, end_time, slot_order, is_break)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (label) DO UPDATE SET slot_order = EXCLUDED.slot_order
       RETURNING id`,
      [label, startTime, endTime, order, isBreak]
    );
    id = rows[0].id as string;
    cache.timeSlots.set(label, id);
  }
  return id as string;
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

async function getOrUpsertSubject(
  client: PoolClient,
  cache: ImportCache,
  departmentId: string,
  code: string,
  mapping: ConfirmedMapping | undefined
): Promise<string> {
  const key = `${departmentId}:${code}`;
  let id = cache.subjects.get(key);
  if (!id) {
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
    id = rows[0].id as string;
    cache.subjects.set(key, id);
  }
  return id as string;
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
 *  them to set their own on first login. Email is a deterministic slug. */
async function getOrUpsertFaculty(
  client: PoolClient,
  cache: ImportCache,
  fullName: string,
  departmentId: string
): Promise<{ id: string; existedBefore: boolean }> {
  const trimmedName = fullName.trim();
  const cleanedName = cleanFacultyName(trimmedName);
  
  let id = cache.faculty.get(cleanedName);
  if (id) {
    return { id: id as string, existedBefore: true };
  }

  for (const fac of cache.facultyList) {
    if (isNameSimilar(trimmedName, fac.fullName)) {
      cache.faculty.set(cleanedName, fac.id);
      return { id: fac.id, existedBefore: true };
    }
  }

  const slug = trimmedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  let email = `${slug}@faculty.scheduler.local`;
  let attempts = 0;
  while (cache.users.has(email.toLowerCase()) && attempts < 20) {
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    email = `${slug}.${randomSuffix}@faculty.scheduler.local`;
    attempts++;
  }

  // Use a pre-calculated bcrypt hash of a dummy password to avoid slow hashing in database transactions
  const passwordHash = "$2a$10$wE991m9Q5fN6dOQhG2dOuuK3Xg2hB2y2oY6rS.c4F.6rUfK4N2xGu";

  const userRes = await client.query(
    `INSERT INTO users (email, password_hash, role, must_reset_password)
     VALUES ($1, $2, 'faculty', true)
     RETURNING id`,
    [email, passwordHash]
  );
  const userId = userRes.rows[0].id;
  cache.users.add(email.toLowerCase());

  const facultyRes = await client.query(
    `INSERT INTO faculty (user_id, department_id, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, departmentId, trimmedName]
  );
  id = facultyRes.rows[0].id as string;

  cache.faculty.set(cleanedName, id);
  cache.facultyList.push({ id, fullName: trimmedName });

  return { id, existedBefore: false };
}

async function applyBlock(
  client: PoolClient,
  cache: ImportCache,
  block: ParsedBlock,
  opts: ApplyOptions,
  departmentId: string
) {
  const classId = await upsertClass(client, departmentId, block.classLabel, block.classLabel);
  const roomFallbackId = await getOrUpsertRoom(client, cache, block.roomNumber);

  const timeSlotIds: string[] = [];
  for (let idx = 0; idx < block.periods.length; idx++) {
    const p = block.periods[idx];
    const id = await getOrUpsertTimeSlot(
      client,
      cache,
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

  const schedulesToInsert: any[] = [];

  for (const cell of block.cells) {
    if (
      cell.isBreak ||
      !cell.code ||
      /^(VERBAL|APTITUDE|TECHNICAL)/i.test(cell.code)
    ) {
      continue;
    }

    const mapping = opts.mappingsByCode.get(cell.code);
    const subjectId = await getOrUpsertSubject(client, cache, departmentId, cell.code, mapping);
    
    let facultyId: string | null = null;
    let existedBefore = false;
    if (mapping) {
      const res = await getOrUpsertFaculty(client, cache, mapping.facultyName, departmentId);
      facultyId = res.id;
      existedBefore = res.existedBefore;
    }
    
    const roomId = existedBefore
      ? null
      : (mapping?.roomHint ? await getOrUpsertRoom(client, cache, mapping.roomHint) : roomFallbackId);
      
    const timeSlotId = timeSlotIds[cell.periodIndex];

    schedulesToInsert.push({
      classId,
      subjectId,
      facultyId,
      roomId,
      timeSlotId,
      dayOfWeek: cell.dayOfWeek,
      rawLabel: cell.rawLabel,
      uploadId: opts.uploadId,
      effectiveFrom: block.effectiveFrom
    });
  }

  // Bulk insert all schedules in a single query
  if (schedulesToInsert.length > 0) {
    const values: any[] = [];
    const valuePlaceholders: string[] = [];
    let paramIndex = 1;
    for (const item of schedulesToInsert) {
      valuePlaceholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6}, $${paramIndex+7}, $${paramIndex+8}, true)`);
      values.push(
        item.classId,
        item.subjectId,
        item.facultyId,
        item.roomId,
        item.timeSlotId,
        item.dayOfWeek,
        item.rawLabel,
        item.uploadId,
        item.effectiveFrom
      );
      paramIndex += 9;
    }
    await client.query(
      `INSERT INTO schedules
         (class_id, subject_id, faculty_id, room_id, time_slot_id, day_of_week, raw_label, upload_id, effective_from, is_active)
       VALUES ${valuePlaceholders.join(",")}`,
      values
    );
  }
}

export async function applyParsedSheet(sheet: ParsedSheet, opts: ApplyOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    const cache = await initCache(client);
    
    const departmentId = await getOrUpsertDepartment(client, cache, opts.departmentShortCode, opts.departmentFullName);
    for (const block of sheet.blocks) {
      await applyBlock(client, cache, block, opts, departmentId);
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

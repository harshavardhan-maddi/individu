import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateFacultyTimetableExcel } from "../services/excelExport.js";

export const facultyRouter = Router();
facultyRouter.use(requireAuth, requireRole("faculty"));

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

async function getFacultySchedule(facultyId: string, dayOfWeek?: string) {
  const params: any[] = [facultyId];
  let dayFilter = "";
  if (dayOfWeek) {
    params.push(dayOfWeek);
    dayFilter = `AND s.day_of_week = $2`;
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.day_of_week, ts.label as time_label, ts.start_time, ts.end_time,
            sub.short_code as subject_code, sub.full_name as subject_name, sub.is_lab, c.name as class_name, r.room_number
     FROM schedules s
     JOIN time_slots ts ON ts.id = s.time_slot_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN rooms r ON r.id = s.room_id
     WHERE s.faculty_id = $1 AND s.is_active ${dayFilter}
     ORDER BY ts.slot_order ASC`,
    params
  );
  return rows;
}

/** Today's full schedule, plus current & next class derived from wall-clock time. */
facultyRouter.get("/schedule/today", async (req, res) => {
  const now = new Date();
  const today = DAY_ORDER[(now.getDay() + 6) % 7]; // JS: Sun=0 -> map to MON..SUN
  const rows = await getFacultySchedule(req.user!.facultyId!, today);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  let current = null;
  let next = null;
  for (const row of rows) {
    const start = toMinutes(row.start_time);
    const end = toMinutes(row.end_time);
    if (nowMinutes >= start && nowMinutes < end) current = row;
    if (!next && start > nowMinutes) next = row;
  }

  res.json({ day: today, schedule: rows, current, next });
});

facultyRouter.get("/schedule/week", async (req, res) => {
  const rows = await getFacultySchedule(req.user!.facultyId!);
  const byDay: Record<string, any[]> = {};
  for (const day of DAY_ORDER) byDay[day] = [];
  for (const row of rows) byDay[row.day_of_week]?.push(row);
  res.json(byDay);
});

facultyRouter.get("/export/excel", async (req, res) => {
  const rows = await getFacultySchedule(req.user!.facultyId!);
  const { rows: meRows } = await pool.query(
    `SELECT f.full_name, d.name as department FROM faculty f LEFT JOIN departments d ON d.id = f.department_id WHERE f.id = $1`,
    [req.user!.facultyId]
  );
  const me = meRows[0];

  const buffer = await generateFacultyTimetableExcel(
    rows.map((r) => ({
      dayOfWeek: r.day_of_week,
      timeLabel: r.time_label,
      subjectCode: r.subject_code ?? "—",
      subjectName: r.subject_name ?? r.raw_label ?? "—",
      className: r.class_name,
      roomNumber: r.room_number,
    })),
    {
      collegeName: process.env.COLLEGE_NAME ?? "Your College Name",
      facultyName: me?.full_name ?? "Faculty",
      departmentName: me?.department ?? "",
      generatedDate: new Date().toLocaleDateString("en-IN"),
    }
  );

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="timetable.xlsx"`);
  res.send(buffer);
});

facultyRouter.patch("/profile", async (req, res) => {
  const { displayName, phone, designation } = req.body ?? {};
  await pool.query(
    `UPDATE faculty SET display_name = COALESCE($1, display_name), phone = COALESCE($2, phone),
       designation = COALESCE($3, designation) WHERE id = $4`,
    [displayName, phone, designation, req.user!.facultyId]
  );
  res.json({ success: true });
});

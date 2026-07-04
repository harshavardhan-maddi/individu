import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { generateFacultyTimetableExcel, generateAllFacultyTimetableExcel } from "../services/excelExport.js";

export const hodRouter = Router();
hodRouter.use(requireAuth, requireRole("hod"));

hodRouter.post("/reset", async (_req, res) => {
  try {
    await pool.query("DELETE FROM logs");
    await pool.query("DELETE FROM schedules");
    await pool.query("DELETE FROM classes");
    await pool.query("DELETE FROM subjects");
    await pool.query("DELETE FROM faculty");
    await pool.query("DELETE FROM users WHERE role = 'faculty'");
    await pool.query("DELETE FROM rooms");
    await pool.query("DELETE FROM departments");
    await pool.query("DELETE FROM uploads");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset database." });
  }
});

hodRouter.get("/stats", async (_req, res) => {
  const [facultyCount, classCount, subjectCount, todayCount] = await Promise.all([
    pool.query(`SELECT count(*)::int as n FROM faculty`),
    pool.query(`SELECT count(*)::int as n FROM classes`),
    pool.query(`SELECT count(*)::int as n FROM subjects`),
    pool.query(
      `SELECT count(*)::int as n FROM schedules WHERE is_active AND day_of_week = $1`,
      [["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date().getDay()]]
    ),
  ]);
  res.json({
    facultyCount: facultyCount.rows[0].n,
    classCount: classCount.rows[0].n,
    subjectCount: subjectCount.rows[0].n,
    todaysClasses: todayCount.rows[0].n,
  });
});

hodRouter.get("/faculty", async (req, res) => {
  const { search = "", department = "" } = req.query as { search?: string; department?: string };
  const { rows } = await pool.query(
    `SELECT f.id, f.full_name, f.display_name, d.name as department, u.is_active, u.email
     FROM faculty f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN departments d ON d.id = f.department_id
     WHERE ($1 = '' OR f.full_name ILIKE '%' || $1 || '%')
       AND ($2 = '' OR d.name = $2)
     ORDER BY f.full_name ASC`,
    [search, department]
  );
  res.json(rows);
});

hodRouter.patch("/faculty/:id/status", async (req, res) => {
  const { isActive } = req.body as { isActive: boolean };
  await pool.query(
    `UPDATE users SET is_active = $1 FROM faculty f WHERE f.user_id = users.id AND f.id = $2`,
    [isActive, req.params.id]
  );
  res.json({ success: true });
});

hodRouter.post("/faculty/:id/reset-password", async (req, res) => {
  const bcrypt = (await import("bcryptjs")).default;
  const tempPassword = Math.random().toString(36).slice(2, 10);
  const hash = await bcrypt.hash(tempPassword, 10);
  await pool.query(
    `UPDATE users SET password_hash = $1, must_reset_password = true FROM faculty f WHERE f.user_id = users.id AND f.id = $2`,
    [hash, req.params.id]
  );
  // In production: email this to the faculty member instead of returning it.
  res.json({ success: true, temporaryPassword: tempPassword });
});

hodRouter.get("/faculty/:id/schedule", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.day_of_week, ts.label as time_label, sub.full_name as subject_name, c.name as class_name, r.room_number
     FROM schedules s
     JOIN time_slots ts ON ts.id = s.time_slot_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN rooms r ON r.id = s.room_id
     WHERE s.faculty_id = $1 AND s.is_active
     ORDER BY ts.slot_order ASC`,
    [req.params.id]
  );
  res.json(rows);
});

hodRouter.get("/classes", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, d.name as department FROM classes c LEFT JOIN departments d ON d.id = c.department_id ORDER BY c.name`
  );
  res.json(rows);
});

hodRouter.get("/classes/:id/schedule", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.day_of_week, ts.label as time_label, sub.full_name as subject_name, f.full_name as faculty_name, r.room_number
     FROM schedules s
     JOIN time_slots ts ON ts.id = s.time_slot_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN faculty f ON f.id = s.faculty_id
     LEFT JOIN rooms r ON r.id = s.room_id
     WHERE s.class_id = $1 AND s.is_active
     ORDER BY ts.slot_order ASC`,
    [req.params.id]
  );
  res.json(rows);
});

hodRouter.get("/faculty/:id/export/excel", async (req, res) => {
  const facultyId = req.params.id;
  const { rows } = await pool.query(
    `SELECT s.day_of_week, ts.label as time_label, ts.start_time, ts.end_time,
            sub.short_code as subject_code, sub.full_name as subject_name, c.name as class_name, r.room_number
     FROM schedules s
     JOIN time_slots ts ON ts.id = s.time_slot_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN rooms r ON r.id = s.room_id
     WHERE s.faculty_id = $1 AND s.is_active
     ORDER BY ts.slot_order ASC`,
    [facultyId]
  );

  const { rows: meRows } = await pool.query(
    `SELECT f.full_name, d.name as department FROM faculty f LEFT JOIN departments d ON d.id = f.department_id WHERE f.id = $1`,
    [facultyId]
  );
  const me = meRows[0];

  const buffer = await generateFacultyTimetableExcel(
    rows.map((r) => ({
      dayOfWeek: r.day_of_week,
      timeLabel: r.time_label,
      subjectCode: r.subject_code ?? "—",
      subjectName: r.subject_name ?? "—",
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
  res.setHeader("Content-Disposition", `attachment; filename="timetable_${facultyId}.xlsx"`);
  res.send(buffer);
});

hodRouter.get("/export/all-faculty", async (_req, res) => {
  try {
    const { rows: facultyRows } = await pool.query(
      `SELECT f.id, f.full_name, d.name as department
       FROM faculty f
       LEFT JOIN departments d ON d.id = f.department_id
       ORDER BY f.full_name ASC`
    );

    const facultyData = [];
    for (const fac of facultyRows) {
      const { rows: scheduleRows } = await pool.query(
        `SELECT s.day_of_week, ts.label as time_label,
                sub.short_code as subject_code, sub.full_name as subject_name, c.name as class_name, r.room_number
         FROM schedules s
         JOIN time_slots ts ON ts.id = s.time_slot_id
         LEFT JOIN subjects sub ON sub.id = s.subject_id
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN rooms r ON r.id = s.room_id
         WHERE s.faculty_id = $1 AND s.is_active
         ORDER BY ts.slot_order ASC`,
        [fac.id]
      );

      facultyData.push({
        facultyName: fac.full_name,
        departmentName: fac.department || "General",
        rows: scheduleRows.map((r) => ({
          dayOfWeek: r.day_of_week,
          timeLabel: r.time_label,
          subjectCode: r.subject_code ?? "—",
          subjectName: r.subject_name ?? "—",
          className: r.class_name,
          roomNumber: r.room_number,
        })),
      });
    }

    const buffer = await generateAllFacultyTimetableExcel(facultyData, {
      collegeName: process.env.COLLEGE_NAME ?? "Your College Name",
      generatedDate: new Date().toLocaleDateString("en-IN"),
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="all_faculty_timetables.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export all faculty timetables" });
  }
});


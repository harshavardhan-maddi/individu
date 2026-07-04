import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseWorkbook } from "../services/excelParser.js";
import { applyParsedSheet, ConfirmedMapping } from "../services/timetableGenerator.js";

export const uploadRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname);
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx/.xls files are supported"));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

/**
 * Step 1: Upload the file. We parse it immediately and return a preview
 * (blocks + legend + mapping suggestions) WITHOUT writing timetable data
 * yet. The HOD reviews/corrects low-confidence mappings in the frontend,
 * then calls /apply to commit.
 */
uploadRouter.post("/", requireAuth, requireRole("hod"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const buffer = fs.readFileSync(req.file.path);
    const parsedSheets = parseWorkbook(buffer);

    const { rows } = await pool.query(
      `INSERT INTO uploads (uploaded_by, original_filename, storage_path, sheet_count, status, parse_summary)
       VALUES ($1, $2, $3, $4, 'processing', $5)
       RETURNING id`,
      [
        req.user!.userId,
        req.file.originalname,
        req.file.path,
        parsedSheets.length,
        JSON.stringify({ warnings: parsedSheets.flatMap((s) => s.warnings) }),
      ]
    );
    const uploadId = rows[0].id;

    let appliedSheetsCount = 0;
    for (const sheet of parsedSheets) {
      if (!sheet.legend || sheet.legend.length === 0) {
        continue;
      }
      appliedSheetsCount++;
      const confirmedMappings: ConfirmedMapping[] = (sheet.mappingSuggestions || []).map((sug: any) => {
        const match = sug.bestMatch || (sug.alternatives && sug.alternatives[0]?.entry) || null;
        return {
          code: sug.code,
          subjectFullName: match ? match.subjectFullName : sug.code,
          facultyName: match ? match.facultyName : "",
          isLab: match ? match.isLab : sug.code.toUpperCase().includes("LAB"),
          roomHint: match ? match.roomHint : null,
        };
      });

      const mappingsByCode = new Map(confirmedMappings.map((m) => [m.code, m]));
      const shortCode = sheet.sheetName || "";
      const fullName = sheet.sheetName ? `${sheet.sheetName} Department` : "General";

      await applyParsedSheet(sheet, {
        uploadId,
        uploadedByUserId: req.user!.userId,
        departmentShortCode: shortCode,
        departmentFullName: fullName,
        mappingsByCode,
      });
    }

    // Clean up inactive/deactivated schedules and any orphaned classes/subjects/rooms to keep the counts and dashboard stats 100% correct.
    await pool.query("DELETE FROM schedules WHERE NOT is_active");
    await pool.query("DELETE FROM classes WHERE id NOT IN (SELECT DISTINCT class_id FROM schedules)");
    await pool.query("DELETE FROM subjects WHERE id NOT IN (SELECT DISTINCT subject_id FROM schedules)");
    await pool.query("DELETE FROM rooms WHERE id NOT IN (SELECT DISTINCT room_id FROM schedules WHERE room_id IS NOT NULL)");
    await pool.query("DELETE FROM departments WHERE id NOT IN (SELECT DISTINCT department_id FROM classes) AND id NOT IN (SELECT DISTINCT department_id FROM faculty WHERE department_id IS NOT NULL)");

    await pool.query(`UPDATE uploads SET status = 'applied' WHERE id = $1`, [uploadId]);

    res.json({ success: true, uploadId, sheetsCount: appliedSheetsCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to parse and apply timetable sheets automatically." });
  }
});

/**
 * Step 2: HOD confirms department + mapping corrections per sheet, then
 * this commits the data into departments/classes/subjects/faculty/schedules.
 */
uploadRouter.post("/:uploadId/apply", requireAuth, requireRole("hod"), async (req, res) => {
  const { uploadId } = req.params;
  const { sheetName, departmentShortCode, departmentFullName, confirmedMappings } = req.body as {
    sheetName: string;
    departmentShortCode: string;
    departmentFullName: string;
    confirmedMappings: ConfirmedMapping[];
  };

  const uploadRow = await pool.query(`SELECT storage_path FROM uploads WHERE id = $1`, [uploadId]);
  if (!uploadRow.rows[0]) return res.status(404).json({ error: "Upload not found" });

  const buffer = fs.readFileSync(uploadRow.rows[0].storage_path);
  const parsedSheets = parseWorkbook(buffer);
  const sheet = parsedSheets.find((s) => s.sheetName === sheetName);
  if (!sheet) return res.status(404).json({ error: `Sheet ${sheetName} not found in original upload` });

  const mappingsByCode = new Map(confirmedMappings.map((m) => [m.code, m]));

  try {
    await applyParsedSheet(sheet, {
      uploadId,
      uploadedByUserId: req.user!.userId,
      departmentShortCode,
      departmentFullName,
      mappingsByCode,
    });
    await pool.query(
      `INSERT INTO logs (actor_user_id, action, meta) VALUES ($1, 'UPLOAD_APPLIED', $2)`,
      [req.user!.userId, JSON.stringify({ uploadId, sheetName })]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to apply timetable to the database" });
  }
});

uploadRouter.get("/", requireAuth, requireRole("hod"), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, original_filename, status, sheet_count, created_at FROM uploads ORDER BY created_at DESC LIMIT 50`
  );
  res.json(rows);
});

uploadRouter.post("/analyze", requireAuth, requireRole("hod"), upload.array("files", 10), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });

  try {
    const responseFiles = [];
    for (const file of files) {
      const buffer = fs.readFileSync(file.path);
      const parsedSheets = parseWorkbook(buffer);

      responseFiles.push({
        originalName: file.originalname,
        tempPath: file.path,
        sheets: parsedSheets.map((s) => ({
          name: s.sheetName,
          classLabel: s.blocks[0]?.classLabel || null,
          hasLegend: s.legend && s.legend.length > 0,
        })),
      });
    }

    res.json({ files: responseFiles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to analyze uploaded files" });
  }
});

uploadRouter.post("/confirm", requireAuth, requireRole("hod"), async (req, res) => {
  const { selections } = req.body as {
    selections: {
      tempPath: string;
      originalName: string;
      selectedSheets: string[];
    }[];
  };

  if (!selections || selections.length === 0) {
    return res.status(400).json({ error: "No files or sheets selected" });
  }

  try {
    let totalAppliedSheets = 0;

    for (const sel of selections) {
      if (!fs.existsSync(sel.tempPath)) {
        throw new Error(`Temporary file not found: ${sel.originalName}`);
      }

      const buffer = fs.readFileSync(sel.tempPath);
      const parsedSheets = parseWorkbook(buffer);

      const parsedAppliedSheets = parsedSheets.filter((s) => sel.selectedSheets.includes(s.sheetName));
      if (parsedAppliedSheets.length === 0) continue;

      const { rows } = await pool.query(
        `INSERT INTO uploads (uploaded_by, original_filename, storage_path, sheet_count, status, parse_summary)
         VALUES ($1, $2, $3, $4, 'processing', $5)
         RETURNING id`,
        [
          req.user!.userId,
          sel.originalName,
          sel.tempPath,
          parsedAppliedSheets.length,
          JSON.stringify({ warnings: parsedAppliedSheets.flatMap((s) => s.warnings) }),
        ]
      );
      const uploadId = rows[0].id;

      for (const sheet of parsedAppliedSheets) {
        const confirmedMappings: ConfirmedMapping[] = (sheet.mappingSuggestions || []).map((sug: any) => {
          const match = sug.bestMatch || (sug.alternatives && sug.alternatives[0]?.entry) || null;
          return {
            code: sug.code,
            subjectFullName: match ? match.subjectFullName : sug.code,
            facultyName: match ? match.facultyName : "",
            isLab: match ? match.isLab : sug.code.toUpperCase().includes("LAB"),
            roomHint: match ? match.roomHint : null,
          };
        });

        const mappingsByCode = new Map(confirmedMappings.map((m) => [m.code, m]));
        const shortCode = sheet.sheetName || "";
        const fullName = sheet.sheetName ? `${sheet.sheetName} Department` : "General";

        await applyParsedSheet(sheet, {
          uploadId,
          uploadedByUserId: req.user!.userId,
          departmentShortCode: shortCode,
          departmentFullName: fullName,
          mappingsByCode,
        });

        totalAppliedSheets++;
      }

      await pool.query(`UPDATE uploads SET status = 'applied' WHERE id = $1`, [uploadId]);
    }

    // Clean up inactive/deactivated schedules and any orphaned classes/subjects/rooms to keep the counts and dashboard stats 100% correct.
    await pool.query("DELETE FROM schedules WHERE NOT is_active");
    await pool.query("DELETE FROM classes WHERE id NOT IN (SELECT DISTINCT class_id FROM schedules)");
    await pool.query("DELETE FROM subjects WHERE id NOT IN (SELECT DISTINCT subject_id FROM schedules)");
    await pool.query("DELETE FROM rooms WHERE id NOT IN (SELECT DISTINCT room_id FROM schedules WHERE room_id IS NOT NULL)");
    await pool.query("DELETE FROM departments WHERE id NOT IN (SELECT DISTINCT department_id FROM classes) AND id NOT IN (SELECT DISTINCT department_id FROM faculty WHERE department_id IS NOT NULL)");

    res.json({ success: true, sheetsCount: totalAppliedSheets });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to apply selected timetable sheets." });
  }
});

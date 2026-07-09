import { pool } from "../config/db.js";
import { parseWorkbook } from "../services/excelParser.js";
import { applyParsedSheet, ConfirmedMapping } from "../services/timetableGenerator.js";
import fs from "fs";
import path from "path";

async function run() {
  const sampleFile = "1783154658796-24_Batch_III-I_FINAL TIME_TABLE.xlsx";
  const filePath = path.join("uploads", sampleFile);

  if (!fs.existsSync(filePath)) {
    console.error(`Sample file ${filePath} not found!`);
    process.exit(1);
  }

  console.log(`Reading sample file: ${filePath}`);
  const buffer = fs.readFileSync(filePath);
  const parsedSheets = parseWorkbook(buffer);
  console.log(`Parsed ${parsedSheets.length} sheets.`);

  try {
    // Clear tables so we have a clean test
    console.log("Cleaning database tables...");
    await pool.query("DELETE FROM logs");
    await pool.query("DELETE FROM schedules");
    await pool.query("DELETE FROM uploads");
    await pool.query("DELETE FROM classes");
    await pool.query("DELETE FROM subjects");
    await pool.query("DELETE FROM faculty");
    await pool.query("DELETE FROM users WHERE role = 'faculty' OR email = 'hod_test@college.edu'");
    await pool.query("DELETE FROM rooms");
    await pool.query("DELETE FROM departments");

    // 1. Create HOD user to own the upload
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, role, must_reset_password)
       VALUES ('hod_test@college.edu', 'hash', 'hod', false)
       RETURNING id`
    );
    const hodUserId = userRes.rows[0].id;

    // 2. Insert upload row
    const uploadRes = await pool.query(
      `INSERT INTO uploads (uploaded_by, original_filename, storage_path, status, parse_summary)
       VALUES ($1, $2, $3, 'processing', $4)
       RETURNING id`,
      [
        hodUserId,
        sampleFile,
        filePath,
        JSON.stringify({ warnings: parsedSheets.flatMap((s) => s.warnings) })
      ]
    );
    const uploadId = uploadRes.rows[0].id;

    // 3. Apply the sheets
    for (const sheet of parsedSheets) {
      if (!sheet.legend || sheet.legend.length === 0) {
        continue;
      }
      console.log(`Applying sheet: ${sheet.sheetName}`);

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
        uploadedByUserId: hodUserId,
        departmentShortCode: shortCode,
        departmentFullName: fullName,
        mappingsByCode,
      });
    }

    console.log("SUCCESS: All sheets applied successfully!");
  } catch (error) {
    console.error("FAILURE: Error applying sheets:", error);
  } finally {
    await pool.end();
  }
}

run();

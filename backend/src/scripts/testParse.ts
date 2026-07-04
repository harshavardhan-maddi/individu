/**
 * Quick CLI to sanity-check the parser against a real timetable file
 * without touching the database or the HTTP layer.
 *
 * Usage: npm run parse:test -- /path/to/timetable.xlsx
 */
import fs from "fs";
import { parseWorkbook } from "../services/excelParser.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run parse:test -- <path-to-xlsx>");
  process.exit(1);
}

const buffer = fs.readFileSync(filePath);
const sheets = parseWorkbook(buffer);

for (const sheet of sheets) {
  console.log(`\n=== ${sheet.sheetName} ===`);
  console.log(`Department (row2): ${sheet.departmentName}`);
  console.log(`Blocks: ${sheet.blocks.length}, Legend entries: ${sheet.legend.length}`);
  if (sheet.warnings.length) {
    console.log("Warnings:");
    sheet.warnings.forEach((w) => console.log("  -", w));
  }
  console.log("Mapping suggestions (lowest confidence first):");
  sheet.mappingSuggestions.slice(0, 6).forEach((s) => {
    console.log(
      `  ${s.code.padEnd(15)} -> ${s.bestMatch?.subjectFullName ?? "??"} (${s.bestMatch?.facultyName ?? "no match"}) [conf ${s.confidence.toFixed(2)}]`
    );
  });
}

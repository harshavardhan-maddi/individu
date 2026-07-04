import ExcelJS from "exceljs";

export interface ExportScheduleRow {
  dayOfWeek: string;
  timeLabel: string;
  subjectCode: string;
  subjectName: string;
  className: string;
  roomNumber: string | null;
}

export interface ExportOptions {
  collegeName: string;
  facultyName: string;
  departmentName: string;
  generatedDate: string;
}

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

const TIMETABLE_SLOTS = [
  { label: "09.10-10.00", isBreak: false },
  { label: "10.00-10.50", isBreak: false },
  { label: "10.50-11.00", isBreak: true, text: "TEA BREAK" },
  { label: "11.00-11.50", isBreak: false },
  { label: "11.50-12.40", isBreak: false },
  { label: "12.40-01.30", isBreak: true, text: "LUNCH BREAK" },
  { label: "01.30-02.20", isBreak: false },
  { label: "02.20-03.10", isBreak: false },
  { label: "03.10-04.00", isBreak: false }
];

function normalizeLabel(s: string): string {
  let cleaned = s.replace(/\s+/g, "").replace(/:/g, ".").trim();
  cleaned = cleaned.replace(/^0(\d)/, "$1");
  cleaned = cleaned.replace(/-0(\d)/, "-$1");
  return cleaned;
}

export async function generateFacultyTimetableExcel(
  rows: ExportScheduleRow[],
  opts: ExportOptions
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Faculty Scheduler Pro";
  wb.created = new Date();

  const ws = wb.addWorksheet("Timetable", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const colCount = TIMETABLE_SLOTS.length + 1;

  ws.mergeCells(1, 1, 1, colCount);
  ws.getCell(1, 1).value = opts.collegeName;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: "center" };

  ws.mergeCells(2, 1, 2, colCount);
  ws.getCell(2, 1).value = opts.facultyName;
  ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.getCell(2, 1).alignment = { horizontal: "center" };

  const uniqueSubs = Array.from(
    new Set(
      rows
        .map((r) => `${r.subjectCode} - ${r.subjectName}`)
        .filter((s) => s && !s.startsWith("—") && !s.includes(" - —"))
    )
  );
  const subText = uniqueSubs.length > 0 ? `Subjects: ${uniqueSubs.join(", ")} | ` : "";

  ws.mergeCells(3, 1, 3, colCount);
  ws.getCell(3, 1).value = `${subText}Generated on ${opts.generatedDate}`;
  ws.getCell(3, 1).alignment = { horizontal: "center" };
  ws.getCell(3, 1).font = { italic: true, size: 10, color: { argb: "FF666666" } };

  const headerRowIdx = 5;
  const headerRow = ws.getRow(headerRowIdx);
  headerRow.getCell(1).value = "Day";
  TIMETABLE_SLOTS.forEach((slot, idx) => {
    headerRow.getCell(idx + 2).value = slot.label;
  });
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3730A3" } }; // deep indigo
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder();
  });

  const colWidths = Array(colCount + 1).fill(12);
  colWidths[1] = 8;
  for (let c = 2; c <= colCount; c++) {
    colWidths[c] = Math.max(colWidths[c], TIMETABLE_SLOTS[c - 2].label.length + 4);
  }

  DAY_ORDER.forEach((day, dayIdx) => {
    const rowIdx = headerRowIdx + 1 + dayIdx;
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = day;
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

    // Apply borders to all cells in the row first
    for (let c = 1; c <= colCount; c++) {
      row.getCell(c).border = thinBorder();
    }

    const rowContents: { colIdx: number; isBreak: boolean; value: string }[] = [];
    
    TIMETABLE_SLOTS.forEach((slot, idx) => {
      const colIdx = idx + 2;
      if (slot.isBreak) {
        rowContents.push({ colIdx, isBreak: true, value: slot.text || "BREAK" });
        return;
      }

      const matches = rows.filter((r) => {
        const normR = normalizeLabel(r.timeLabel);
        const normS = normalizeLabel(slot.label);
        return r.dayOfWeek === day && normR === normS;
      });

      let cellValue = "";
      if (matches.length > 0) {
        const firstCode = matches[0].subjectCode;
        const allSameCode = matches.every((m) => m.subjectCode === firstCode);
        if (allSameCode) {
          const classes = matches.map((m) => m.className).join(" & ");
          cellValue = `${firstCode}\n${classes}`;
        } else {
          cellValue = matches
            .map((m) => `${m.subjectCode} (${m.className})`)
            .join("\n");
        }
      }
      rowContents.push({ colIdx, isBreak: false, value: cellValue });
    });

    let startIdx = 0;
    while (startIdx < rowContents.length) {
      const start = rowContents[startIdx];
      
      if (start.isBreak || start.value === "") {
        const cell = row.getCell(start.colIdx);
        cell.value = start.value;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        if (start.isBreak) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } }; // light gray
          cell.font = { italic: true, size: 9, color: { argb: "FF4B5563" } };
        } else if (dayIdx % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        }
        startIdx++;
        continue;
      }

      let endIdx = startIdx + 1;
      while (
        endIdx < rowContents.length &&
        !rowContents[endIdx].isBreak &&
        rowContents[endIdx].value === start.value
      ) {
        endIdx++;
      }

      const mergeCount = endIdx - startIdx;
      if (mergeCount > 1) {
        ws.mergeCells(rowIdx, start.colIdx, rowIdx, rowContents[endIdx - 1].colIdx);
        const cell = row.getCell(start.colIdx);
        cell.value = start.value;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        
        for (let c = start.colIdx; c <= rowContents[endIdx - 1].colIdx; c++) {
          if (dayIdx % 2 === 0) {
            row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
          }
        }
        const valMaxLen = getMaxLineLength(start.value);
        const neededWidth = Math.ceil(valMaxLen / mergeCount) + 4;
        for (let c = start.colIdx; c < start.colIdx + mergeCount; c++) {
          colWidths[c] = Math.max(colWidths[c], neededWidth);
        }
      } else {
        const cell = row.getCell(start.colIdx);
        cell.value = start.value;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        if (dayIdx % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        }
        const valMaxLen = getMaxLineLength(start.value);
        colWidths[start.colIdx] = Math.max(colWidths[start.colIdx], valMaxLen + 4);
      }

      startIdx = endIdx;
    }
  });

  for (let c = 1; c <= colCount; c++) {
    ws.getColumn(c).width = colWidths[c];
  }
  ws.getRow(headerRowIdx).height = 22;
  for (let r = headerRowIdx + 1; r <= headerRowIdx + DAY_ORDER.length; r++) ws.getRow(r).height = 45;

  return wb.xlsx.writeBuffer();
}

export async function generateAllFacultyTimetableExcel(
  facultyData: {
    facultyName: string;
    departmentName: string;
    rows: ExportScheduleRow[];
  }[],
  opts: { collegeName: string; generatedDate: string }
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Faculty Scheduler Pro";
  wb.created = new Date();

  for (const fac of facultyData) {
    const safeSheetName = fac.facultyName
      .replace(/^(Mr|Mrs|Dr|Ms)\.?\s+/i, "")
      .replace(/[\\\/:\?\*\[\]]/g, "")
      .trim()
      .slice(0, 31) || "Faculty";

    let finalSheetName = safeSheetName;
    let count = 1;
    while (wb.getWorksheet(finalSheetName)) {
      finalSheetName = `${safeSheetName.slice(0, 27)}_${count++}`;
    }

    const ws = wb.addWorksheet(finalSheetName, {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const colCount = TIMETABLE_SLOTS.length + 1;

    ws.mergeCells(1, 1, 1, colCount);
    ws.getCell(1, 1).value = opts.collegeName;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(1, 1).alignment = { horizontal: "center" };

    ws.mergeCells(2, 1, 2, colCount);
    ws.getCell(2, 1).value = fac.facultyName;
    ws.getCell(2, 1).font = { bold: true, size: 12 };
    ws.getCell(2, 1).alignment = { horizontal: "center" };

    const uniqueSubs = Array.from(
      new Set(
        fac.rows
          .map((r) => `${r.subjectCode} - ${r.subjectName}`)
          .filter((s) => s && !s.startsWith("—") && !s.includes(" - —"))
      )
    );
    const subText = uniqueSubs.length > 0 ? `Subjects: ${uniqueSubs.join(", ")} | ` : "";

    ws.mergeCells(3, 1, 3, colCount);
    ws.getCell(3, 1).value = `${subText}Generated on ${opts.generatedDate}`;
    ws.getCell(3, 1).alignment = { horizontal: "center" };
    ws.getCell(3, 1).font = { italic: true, size: 10, color: { argb: "FF666666" } };

    const headerRowIdx = 5;
    const headerRow = ws.getRow(headerRowIdx);
    headerRow.getCell(1).value = "Day";
    TIMETABLE_SLOTS.forEach((slot, idx) => {
      headerRow.getCell(idx + 2).value = slot.label;
    });
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3730A3" } }; // deep indigo
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder();
    });

    const colWidths = Array(colCount + 1).fill(12);
    colWidths[1] = 8;
    for (let c = 2; c <= colCount; c++) {
      colWidths[c] = Math.max(colWidths[c], TIMETABLE_SLOTS[c - 2].label.length + 4);
    }

    DAY_ORDER.forEach((day, dayIdx) => {
      const rowIdx = headerRowIdx + 1 + dayIdx;
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = day;
      row.getCell(1).font = { bold: true };
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

      for (let c = 1; c <= colCount; c++) {
        row.getCell(c).border = thinBorder();
      }

      const rowContents: { colIdx: number; isBreak: boolean; value: string }[] = [];

      TIMETABLE_SLOTS.forEach((slot, idx) => {
        const colIdx = idx + 2;
        if (slot.isBreak) {
          rowContents.push({ colIdx, isBreak: true, value: slot.text || "BREAK" });
          return;
        }

        const matches = fac.rows.filter((r) => {
          const normR = normalizeLabel(r.timeLabel);
          const normS = normalizeLabel(slot.label);
          return r.dayOfWeek === day && normR === normS;
        });

        let cellValue = "";
        if (matches.length > 0) {
          const firstCode = matches[0].subjectCode;
          const allSameCode = matches.every((m) => m.subjectCode === firstCode);
          if (allSameCode) {
            const classes = matches.map((m) => m.className).join(" & ");
            cellValue = `${firstCode}\n${classes}`;
          } else {
            cellValue = matches
              .map((m) => `${m.subjectCode} (${m.className})`)
              .join("\n");
          }
        }
        rowContents.push({ colIdx, isBreak: false, value: cellValue });
      });

      let startIdx = 0;
      while (startIdx < rowContents.length) {
        const start = rowContents[startIdx];

        if (start.isBreak || start.value === "") {
          const cell = row.getCell(start.colIdx);
          cell.value = start.value;
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          if (start.isBreak) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } }; // light gray
            cell.font = { italic: true, size: 9, color: { argb: "FF4B5563" } };
          } else if (dayIdx % 2 === 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
          }
          startIdx++;
          continue;
        }

        let endIdx = startIdx + 1;
        while (
          endIdx < rowContents.length &&
          !rowContents[endIdx].isBreak &&
          rowContents[endIdx].value === start.value
        ) {
          endIdx++;
        }

        const mergeCount = endIdx - startIdx;
        if (mergeCount > 1) {
          ws.mergeCells(rowIdx, start.colIdx, rowIdx, rowContents[endIdx - 1].colIdx);
          const cell = row.getCell(start.colIdx);
          cell.value = start.value;
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

          for (let c = start.colIdx; c <= rowContents[endIdx - 1].colIdx; c++) {
            if (dayIdx % 2 === 0) {
              row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
            }
          }
          const valMaxLen = getMaxLineLength(start.value);
          const neededWidth = Math.ceil(valMaxLen / mergeCount) + 4;
          for (let c = start.colIdx; c < start.colIdx + mergeCount; c++) {
            colWidths[c] = Math.max(colWidths[c], neededWidth);
          }
        } else {
          const cell = row.getCell(start.colIdx);
          cell.value = start.value;
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          if (dayIdx % 2 === 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
          }
          const valMaxLen = getMaxLineLength(start.value);
          colWidths[start.colIdx] = Math.max(colWidths[start.colIdx], valMaxLen + 4);
        }

        startIdx = endIdx;
      }
    });

    for (let c = 1; c <= colCount; c++) {
      ws.getColumn(c).width = colWidths[c];
    }

    ws.getRow(headerRowIdx).height = 22;
    for (let r = headerRowIdx + 1; r <= headerRowIdx + DAY_ORDER.length; r++) ws.getRow(r).height = 45;
  }

  return wb.xlsx.writeBuffer();
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const style: ExcelJS.BorderStyle = "thin";
  return {
    top: { style, color: { argb: "FFCCCCCC" } },
    left: { style, color: { argb: "FFCCCCCC" } },
    bottom: { style, color: { argb: "FFCCCCCC" } },
    right: { style, color: { argb: "FFCCCCCC" } },
  };
}

function getMaxLineLength(val: string): number {
  if (!val) return 0;
  const lines = String(val).split("\n");
  let max = 0;
  for (const line of lines) {
    if (line.length > max) max = line.length;
  }
  return max;
}

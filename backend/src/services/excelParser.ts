/**
 * Excel Timetable Parser
 * ----------------------
 * Design note (read this before "fixing" the matcher):
 *
 * Real college timetable sheets are NOT machine-generated with a consistent
 * schema. We verified this against actual uploaded files: every department
 * sheet follows the same *structural* pattern (title rows → a header row of
 * time-slot ranges → six day rows MON-SAT → a legend table mapping subject
 * names to faculty), and that structure is 100% mechanically extractable.
 *
 * BUT the day-grid uses short codes ("CC", "ICS", "ATCD") while the legend
 * has full subject names ("Cloud Computing"), and the abbreviation rule is
 * inconsistent between sheets (sometimes initials, sometimes the literal
 * word, sometimes initials + "LAB" suffix). There is no single deterministic
 * rule that maps one to the other with 100% accuracy across all colleges.
 *
 * So: we do STRUCTURAL extraction deterministically (rows/columns/merges),
 * and CODE-TO-SUBJECT mapping heuristically with a confidence score.
 * Anything below CONFIDENCE_THRESHOLD is surfaced to the HOD for manual
 * confirmation in the upload-review screen (see routes/upload.routes.ts).
 * This mirrors how a human would actually resolve ambiguity, and it's far
 * more honest than silently guessing wrong.
 */

import * as XLSX from "xlsx";

// ---------- Types ----------

export interface ParsedPeriodCell {
  dayOfWeek: string; // MON..SAT
  periodIndex: number;
  rawLabel: string; // original text, e.g. "TECHNICAL - III AIC ROOM"
  code: string; // normalized code with room hints stripped, e.g. "TECHNICAL"
  isBreak: boolean;
}

export interface ParsedBlock {
  sheetName: string;
  classLabel: string; // "III-I (CS)- CREAM"
  roomNumber: string | null;
  effectiveFrom: string | null;
  periods: { label: string; startTime: string; endTime: string; isBreak: boolean }[];
  cells: ParsedPeriodCell[];
}

export interface LegendEntry {
  subjectFullName: string;
  facultyName: string;
  isLab: boolean;
  roomHint: string | null;
}

export interface CodeMappingSuggestion {
  code: string;
  bestMatch: LegendEntry | null;
  confidence: number; // 0..1
  alternatives: { entry: LegendEntry; confidence: number }[];
}

export interface ParsedSheet {
  sheetName: string;
  departmentName: string | null;
  classTitle: string | null;
  blocks: ParsedBlock[];
  legend: LegendEntry[];
  mappingSuggestions: CodeMappingSuggestion[];
  warnings: string[];
}

// ---------- Constants ----------

const DAY_RE = /^(MON|TUE|WED|THU|FRI|SAT|SUN)/i;
const TIME_RANGE_RE = /(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})/;
const NON_TEACHING_CODES = new Set(["BREAK", "LUNCH", "LIBRARY"]);

function isNonTeachingCode(code: string): boolean {
  const norm = code.toUpperCase().trim();
  if (NON_TEACHING_CODES.has(norm)) return true;
  
  if (/^BREA[MKD]\b/i.test(norm)) return true;
  if (/^LUN[CS]H\b/i.test(norm) || /^LNCH\b/i.test(norm)) return true;
  if (/^LHUN/i.test(norm)) return true;
  if (/^TEA\b/i.test(norm)) return true;
  if (/^LIBRARY\b/i.test(norm) || /^LIB\b/i.test(norm)) return true;
  if (/^SPORTS\b/i.test(norm) || /^PLAY\b/i.test(norm) || /^GAME/i.test(norm)) return true;
  if (/^SEMINAR\b/i.test(norm) || /^COUNSELLING\b/i.test(norm)) return true;
  if (/^COUNSEL/i.test(norm) || /^PROJECT\b/i.test(norm)) return true;
  if (/^CRT\b/i.test(norm) || /^TECHNICAL\b/i.test(norm)) return true;
  if (/^APTITUDE\b/i.test(norm) || /^VERBAL\b/i.test(norm)) return true;
  if (/^APTTITUDE\b/i.test(norm) || /^INTERNET\b/i.test(norm)) return true;

  return false;
}
const CONFIDENCE_THRESHOLD = 0.72;
const STOPWORDS = new Set(["and", "to", "of", "the", "on", "a", "an", "for", "in"]);

// ---------- Sheet -> filled grid (merged cells propagated) ----------

function sheetToFilledGrid(ws: XLSX.WorkSheet): (string | number | null)[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const grid: (string | number | null)[][] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (string | number | null)[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cell.v ?? null : null);
    }
    grid.push(row);
  }

  // Propagate merged cell values to every cell in the merge range, only if empty.
  for (const merge of ws["!merges"] ?? []) {
    const topLeft = grid[merge.s.r]?.[merge.s.c];
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (grid[r]) {
          const current = grid[r][c];
          if (current === null || current === undefined || String(current).trim() === "") {
            grid[r][c] = topLeft;
          }
        }
      }
    }
  }

  // Propagate LAB subjects to consecutive empty cells (up to the next break or non-empty cell)
  // to handle cases where the Excel sheet has incomplete merges for lab periods.
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val && typeof val === "string" && /\bLAB\b/i.test(val)) {
        let nextCol = c + 1;
        while (nextCol < row.length) {
          const nextVal = row[nextCol];
          if (nextVal === null || nextVal === undefined || String(nextVal).trim() === "") {
            row[nextCol] = val;
            nextCol++;
          } else {
            break;
          }
        }
        c = nextCol - 1;
      }
    }
  }

  return grid;
}

// ---------- Block (weekly grid) detection ----------

function detectBlocks(grid: (string | number | null)[][], sheetName: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < grid.length) {
    const row = grid[i];
    const timeCols: number[] = [];
    row.forEach((v, j) => {
      if (typeof v === "string" && TIME_RANGE_RE.test(v)) timeCols.push(j);
    });

    if (timeCols.length >= 2 && row[0]) {
      const classLabel = String(row[0]).trim();
      const periods = timeCols.map((j) => {
        const label = String(row[j]).trim();
        const m = TIME_RANGE_RE.exec(label)!;
        return {
          label,
          startTime: `${m[1].padStart(2, "0")}:${m[2]}`,
          endTime: `${m[3].padStart(2, "0")}:${m[4]}`,
          isBreak: false,
        };
      });

      // room number + W.E.F date usually live a few rows above; look upward a bit
      let roomNumber: string | null = null;
      let effectiveFrom: string | null = null;
      for (let k = Math.max(0, i - 4); k < i; k++) {
        const r = grid[k];
        if (r[0] && String(r[0]).toUpperCase().includes("ROOM NO")) {
          const val = r.find((v, idx) => idx > 0 && v !== null && v !== "");
          if (val !== undefined) roomNumber = String(val);
        }
        for (const v of r) {
          if (typeof v === "string" && v.toUpperCase().includes("W.E.F")) {
            const dateMatch = v.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
            if (dateMatch) effectiveFrom = dateMatch[1];
          }
        }
      }

      const cells: ParsedPeriodCell[] = [];
      let k = i + 1;
      while (k < grid.length && grid[k][0] && DAY_RE.test(String(grid[k][0]))) {
        const day = DAY_RE.exec(String(grid[k][0]))![1].toUpperCase();
        timeCols.forEach((colIdx, periodIndex) => {
          const raw = grid[k][colIdx];
          const rawLabel = raw === null || raw === undefined ? "" : String(raw).trim();
          // strip trailing " - ROOM HINT" / " (Room No. X)" style annotations to get the pure code
          const code = rawLabel
            .replace(/\(.*?\)/g, "")
            .split(" - ")[0]
            .replace(/-(\d{3,4})$/, "")
            .trim()
            .toUpperCase();
          const isBreak = isNonTeachingCode(rawLabel) || isNonTeachingCode(code);
          cells.push({ dayOfWeek: day, periodIndex, rawLabel, code, isBreak });
        });
        k++;
      }

      // mark break columns on the periods array too, based on any cell using BREAK/LUNCH
      periods.forEach((p, idx) => {
        p.isBreak = cells.some((c) => c.periodIndex === idx && c.isBreak);
      });

      blocks.push({ sheetName, classLabel, roomNumber, effectiveFrom, periods, cells });
      i = k;
    } else {
      i++;
    }
  }

  return blocks;
}

// ---------- Legend (subject -> faculty) detection ----------

function detectLegend(grid: (string | number | null)[][]): LegendEntry[] {
  const legend: LegendEntry[] = [];
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (row[0] && String(row[0]).toUpperCase().includes("SUBJECT NAME")) {
      let k = i + 1;
      while (k < grid.length && grid[k][0]) {
        const subjectFullNameRaw = String(grid[k][0]).trim();
        let facultyName: string | null = null;
        for (let c = 1; c < grid[k].length; c++) {
          if (
            grid[k][c] !== null &&
            grid[k][c] !== "" &&
            String(grid[k][c]).trim().toLowerCase() !== subjectFullNameRaw.toLowerCase()
          ) {
            facultyName = String(grid[k][c]).trim();
            break;
          }
        }
        if (facultyName) {
          const roomHintMatch = subjectFullNameRaw.match(/\(Room No\.?\s*([\w\d]+)\)/i);
          legend.push({
            subjectFullName: subjectFullNameRaw.replace(/\(.*?\)/g, "").trim(),
            facultyName,
            isLab: /lab/i.test(subjectFullNameRaw),
            roomHint: roomHintMatch ? roomHintMatch[1] : null,
          });
        }
        k++;
      }
      break;
    }
  }
  return legend;
}

// ---------- Code <-> Subject fuzzy matching ----------

function toInitialsCode(fullName: string): { withoutLab: string; withLab: string } {
  const cleaned = fullName.replace(/\(.*?\)/g, "").replace(/[^A-Za-z0-9\s]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const isLab = words.some((w) => w.toLowerCase() === "lab");
  const significant = words.filter(
    (w) => !STOPWORDS.has(w.toLowerCase()) && w.toLowerCase() !== "lab" && !/\d/.test(w)
  );
  const initials = significant
    .filter((w) => /[A-Za-z]/.test(w[0]))
    .map((w) => w[0].toUpperCase())
    .join("");
  const digits = significant.filter((w) => /^\d+$/.test(w)).join("");
  const base = initials + digits;
  return { withoutLab: base, withLab: isLab ? `${base} LAB` : base };
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

function scoreMatch(code: string, entry: LegendEntry): number {
  const normCode = code.replace(/\s+/g, " ").trim().toUpperCase();
  const codeMinusLab = normCode.replace(/\s*LAB$/, "");

  const codeIsLab = /\bLAB\b/i.test(normCode);
  const entryIsLab = entry.isLab || /\blab\b/i.test(entry.subjectFullName);

  // If one is lab and the other is theory, apply a penalty rather than rejecting immediately.
  // This allows "PE LAB" to fall back to the "PE" theory entry if no lab is explicitly listed in the legend.
  const labMismatchPenalty = codeIsLab !== entryIsLab ? 0.75 : 1.0;

  const { withoutLab, withLab } = toInitialsCode(entry.subjectFullName);

  // Exact match
  if (normCode === withLab || normCode === withoutLab) return 1 * labMismatchPenalty;

  // Prefix initials match (e.g. ADS matching ADSAA)
  if (withoutLab.startsWith(normCode) || normCode.startsWith(withoutLab)) {
    return 0.9 * labMismatchPenalty;
  }

  // Exact word match within subject full name (e.g. JAVA in Object Oriented Programming Through Java)
  const entryWords = entry.subjectFullName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()) && w !== "LAB" && !/\d/.test(w));
  
  if (entryWords.includes(codeMinusLab)) {
    return 0.85 * labMismatchPenalty;
  }

  // single-word subjects are sometimes written out in full in the grid
  // (e.g. "Flutter Lab" -> grid shows "FLUTTER LAB", not "F LAB")
  const firstWord = entryWords[0];
  if (firstWord && codeMinusLab === firstWord) return 0.95 * labMismatchPenalty;

  // fallback: normalized edit-distance similarity, penalized so it never beats a real match
  const dist = levenshtein(normCode, withoutLab);
  const maxLen = Math.max(normCode.length, withoutLab.length, 1);
  const similarity = 1 - dist / maxLen;
  return Math.max(0, similarity * 0.6 * labMismatchPenalty);
}

function buildMappingSuggestions(blocks: ParsedBlock[], legend: LegendEntry[]): CodeMappingSuggestion[] {
  const codes = new Set<string>();
  for (const block of blocks) {
    for (const cell of block.cells) {
      if (!cell.isBreak && cell.code) codes.add(cell.code);
    }
  }

  const suggestions: CodeMappingSuggestion[] = [];
  for (const code of codes) {
    const scored = legend
      .map((entry) => ({ entry, confidence: scoreMatch(code, entry) }))
      .sort((a, b) => b.confidence - a.confidence);

    suggestions.push({
      code,
      bestMatch: scored[0]?.confidence >= CONFIDENCE_THRESHOLD ? scored[0].entry : null,
      confidence: scored[0]?.confidence ?? 0,
      alternatives: scored.slice(0, 4),
    });
  }

  return suggestions.sort((a, b) => a.confidence - b.confidence); // low-confidence first, for review UI
}

// ---------- Public entry point ----------

export function parseWorkbook(buffer: Buffer): ParsedSheet[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const results: ParsedSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const grid = sheetToFilledGrid(ws);
    if (grid.length === 0) continue;

    const blocks = detectBlocks(grid, sheetName);
    if (blocks.length === 0) {
      // Sheet doesn't match the expected weekly-grid pattern (e.g. a notes/draft
      // sheet) — skip it but don't fail the whole upload.
      continue;
    }

    const legend = detectLegend(grid);
    const mappingSuggestions = buildMappingSuggestions(blocks, legend);
    const warnings: string[] = [];

    const lowConfidence = mappingSuggestions.filter((s) => !s.bestMatch);
    if (lowConfidence.length > 0) {
      warnings.push(
        `${lowConfidence.length} subject code(s) could not be confidently matched to the legend: ${lowConfidence
          .map((s) => s.code)
          .join(", ")}. These need manual confirmation.`
      );
    }
    if (legend.length === 0) {
      warnings.push("No SUBJECT NAME / FACULTY NAME legend table found on this sheet.");
    }

    results.push({
      sheetName,
      departmentName: (grid[1]?.[0] as string) ?? null,
      classTitle: (grid[2]?.[0] as string) ?? null,
      blocks,
      legend,
      mappingSuggestions,
      warnings,
    });
  }

  return results;
}

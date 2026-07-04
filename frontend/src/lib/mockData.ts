// This mock data mirrors the ACTUAL structure parsed from the uploaded
// "24_Batch_III-I_FINAL_TIME_TABLE.xlsx" (III CS - CREAM section, faculty
// Mr. A. Veema Rao / Cloud Computing) so the UI demo reflects real shape
// and volume of data, not a made-up example. Swap for live API calls once
// the backend is running — see lib/api.ts.
import { ScheduleEntry, FacultyProfile, HodStats, FacultyListItem } from "../types";

export const mockFaculty: FacultyProfile = {
  id: "f-001",
  fullName: "Mr. A. Veema Rao",
  displayName: "Veema Rao",
  department: "CSE (Cyber Security)",
};

export const mockWeekSchedule: ScheduleEntry[] = [
  { dayOfWeek: "MON", timeLabel: "09.10-10.00", startTime: "09:10", endTime: "10:00", subjectName: "Aptitude", className: "III-I (CS) CREAM", roomNumber: "1302" },
  { dayOfWeek: "MON", timeLabel: "11.00-11.50", startTime: "11:00", endTime: "11:50", subjectName: "Cloud Computing", className: "III-I (CS) CREAM", roomNumber: "1302" },
  { dayOfWeek: "MON", timeLabel: "01.30-02.20", startTime: "13:30", endTime: "14:20", subjectName: "Automata Theory & Compiler Design", className: "III-I (CS) CREAM", roomNumber: "1302" },

  { dayOfWeek: "TUE", timeLabel: "09.10-10.00", startTime: "09:10", endTime: "10:00", subjectName: "Cloud Computing Lab", className: "III-I (CS) CREAM", roomNumber: "3305", isLab: true },
  { dayOfWeek: "TUE", timeLabel: "01.30-02.20", startTime: "13:30", endTime: "14:20", subjectName: "Intro to Cyber Security", className: "III-I (CS) CREAM", roomNumber: "1302" },

  { dayOfWeek: "WED", timeLabel: "01.30-02.20", startTime: "13:30", endTime: "14:20", subjectName: "Cloud Computing", className: "III-I (CS) CREAM", roomNumber: "1302" },

  { dayOfWeek: "THU", timeLabel: "01.30-02.20", startTime: "13:30", endTime: "14:20", subjectName: "Cloud Computing", className: "III-I (CS) CREAM", roomNumber: "1302" },
  { dayOfWeek: "THU", timeLabel: "02.20-03.10", startTime: "14:20", endTime: "15:10", subjectName: "Intro to Cyber Security", className: "III-I (CS) CREAM", roomNumber: "1302" },

  { dayOfWeek: "FRI", timeLabel: "09.10-10.00", startTime: "09:10", endTime: "10:00", subjectName: "Cyber Security Lab", className: "III-I (CS) CREAM", roomNumber: "3305", isLab: true },

  { dayOfWeek: "SAT", timeLabel: "02.20-03.10", startTime: "14:20", endTime: "15:10", subjectName: "Cloud Computing", className: "III-I (CS) CREAM", roomNumber: "1302" },
];

export const mockHodStats: HodStats = {
  facultyCount: 34,
  classCount: 9,
  subjectCount: 22,
  todaysClasses: 61,
};

export const mockFacultyList: FacultyListItem[] = [
  { id: "f-001", fullName: "Mr.A.Veema Rao", department: "CSE (Cyber Security)", isActive: true, email: "a.veema.rao@faculty.scheduler.local" },
  { id: "f-002", fullName: "Mrs.M.Revathi", department: "CSE (Cyber Security)", isActive: true, email: "m.revathi@faculty.scheduler.local" },
  { id: "f-003", fullName: "Mr.G.Nageswara Rao", department: "CSE (Cyber Security)", isActive: true, email: "g.nageswara.rao@faculty.scheduler.local" },
  { id: "f-004", fullName: "Dr.Sk.Md.Shareef", department: "AIML", isActive: true, email: "sk.md.shareef@faculty.scheduler.local" },
  { id: "f-005", fullName: "Mrs.K.Sireesha", department: "CSE (AI)", isActive: false, email: "k.sireesha@faculty.scheduler.local" },
];

export function deriveTodayAndNext(schedule: ScheduleEntry[], day: string) {
  const todays = schedule.filter((s) => s.dayOfWeek === day);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  let current: ScheduleEntry | null = null;
  let next: ScheduleEntry | null = null;
  const withStatus = todays.map((s) => {
    const start = toMin(s.startTime);
    const end = toMin(s.endTime);
    let status: ScheduleEntry["status"] = "upcoming";
    if (nowMinutes >= end) status = "completed";
    else if (nowMinutes >= start && nowMinutes < end) {
      status = "current";
      current = s;
    }
    if (!next && start > nowMinutes) next = { ...s };
    return { ...s, status };
  });
  return { todays: withStatus, current, next };
}

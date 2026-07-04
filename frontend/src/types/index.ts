export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface ScheduleEntry {
  id?: string;
  dayOfWeek: DayOfWeek;
  timeLabel: string; // "09.10-10.00"
  startTime: string; // "09:10"
  endTime: string; // "10:00"
  subjectName: string;
  isLab?: boolean;
  className: string;
  roomNumber: string | null;
  status?: "completed" | "current" | "upcoming";
}

export interface FacultyProfile {
  id: string;
  fullName: string;
  displayName?: string;
  department: string;
  avatarUrl?: string;
}

export interface HodStats {
  facultyCount: number;
  classCount: number;
  subjectCount: number;
  todaysClasses: number;
}

export interface FacultyListItem {
  id: string;
  fullName: string;
  displayName?: string;
  department: string;
  isActive: boolean;
  email: string;
}

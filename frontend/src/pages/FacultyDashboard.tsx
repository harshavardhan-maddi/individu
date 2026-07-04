import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { HeroCard } from "../components/HeroCard";
import { DayTimeline } from "../components/DayTimeline";
import { WeekStrip } from "../components/WeekStrip";
import { mockFaculty, mockWeekSchedule, deriveTodayAndNext } from "../lib/mockData";
import { api } from "../lib/api";
import { ScheduleEntry, FacultyProfile } from "../types";

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export default function FacultyDashboard() {
  const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7];
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [profile, setProfile] = useState<FacultyProfile | null>(null);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [meRes, schedRes] = await Promise.all([
          api.get("/auth/me"),
          api.get("/faculty/schedule/week")
        ]);

        if (meRes.data) {
          setProfile({
            id: meRes.data.faculty_id || meRes.data.id,
            fullName: meRes.data.full_name || meRes.data.display_name || "Faculty",
            displayName: meRes.data.display_name || "Faculty",
            department: meRes.data.department || "General",
          });
        }

        if (schedRes.data) {
          const flatSchedule: ScheduleEntry[] = [];
          Object.values(schedRes.data).forEach((dayRows: any) => {
            if (Array.isArray(dayRows)) {
              dayRows.forEach((row) => {
                flatSchedule.push({
                  dayOfWeek: row.day_of_week,
                  timeLabel: row.time_label,
                  startTime: row.start_time,
                  endTime: row.end_time,
                  subjectName: row.subject_name || "—",
                  className: row.class_name,
                  roomNumber: row.room_number,
                  isLab: row.is_lab || false,
                });
              });
            }
          });
          setSchedule(flatSchedule);
        }
      } catch (err) {
        console.error("Failed to load live data, falling back to mock data", err);
        setProfile(mockFaculty);
        setSchedule(mockWeekSchedule);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const countsByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of schedule) counts[s.dayOfWeek] = (counts[s.dayOfWeek] ?? 0) + 1;
    return counts;
  }, [schedule]);

  const { todays, next } = useMemo(
    () => deriveTodayAndNext(schedule, selectedDay),
    [schedule, selectedDay]
  );

  async function handleDownload() {
    try {
      const response = await api.get("/faculty/export/excel", {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${(profile || mockFaculty).fullName}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Failed to download timetable", err);
      alert("Could not download timetable. Ensure the backend server and database are running.");
    }
  }

  const activeProfile = profile || mockFaculty;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">
      <AppHeader name={activeProfile.fullName} department="" />

      <HeroCard
        facultyName={activeProfile.fullName}
        totalClassesToday={countsByDay[todayKey] ?? 0}
        next={selectedDay === todayKey ? next : null}
      />

      <div className="mt-6">
        <WeekStrip selected={selectedDay} onSelect={setSelectedDay} countsByDay={countsByDay} />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {selectedDay === todayKey ? "Today" : selectedDay}
        </h2>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-300 glass-card !p-0 px-4 py-2 hover:bg-white/10 transition-colors"
        >
          <Download size={16} /> Download Timetable
        </button>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-center py-10 text-slate-500 dark:text-slate-400">Loading schedule...</div>
        ) : (
          <DayTimeline entries={todays} />
        )}
      </div>
    </div>
  );
}

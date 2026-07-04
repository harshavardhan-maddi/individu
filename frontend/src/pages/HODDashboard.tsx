import { useEffect, useState, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { Users, BookOpen, Building2, CalendarCheck, Upload, Search, ToggleLeft, ToggleRight, Download } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { GlassCard } from "../components/GlassCard";
import { DayTimeline } from "../components/DayTimeline";
import { WeekStrip } from "../components/WeekStrip";
import { mockHodStats, mockFacultyList } from "../lib/mockData";
import { api } from "../lib/api";
import { FacultyListItem, HodStats, ScheduleEntry } from "../types";

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const STAT_CARDS = [
  { key: "facultyCount", label: "Faculty", icon: Users, color: "from-indigo-500 to-indigo-400" },
  { key: "classCount", label: "Classes", icon: Building2, color: "from-cyan-500 to-cyan-400" },
  { key: "subjectCount", label: "Subjects", icon: BookOpen, color: "from-violet-500 to-violet-400" },
  { key: "todaysClasses", label: "Today's Classes", icon: CalendarCheck, color: "from-emerald-500 to-emerald-400" },
] as const;

interface ConfirmedMapping {
  code: string;
  subjectFullName: string;
  facultyName: string;
  isLab: boolean;
  roomHint: string | null;
}

export default function HODDashboard() {
  const [search, setSearch] = useState("");
  const [faculty, setFaculty] = useState<FacultyListItem[]>([]);
  const [stats, setStats] = useState<HodStats | null>(null);
  const [hodName, setHodName] = useState("Dr. HOD");
  const [hodDept, setHodDept] = useState("Department of CSE");
  const [loading, setLoading] = useState(true);

  // Selection states
  const [pendingUploads, setPendingUploads] = useState<any[]>([]);
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [isApplyingSelections, setIsApplyingSelections] = useState(false);

  // Upload/Preview states
  const [isUploading, setIsUploading] = useState(false);

  // Faculty Schedule View states
  const [selectedFacultySchedule, setSelectedFacultySchedule] = useState<FacultyListItem | null>(null);
  const [facultyScheduleEntries, setFacultyScheduleEntries] = useState<ScheduleEntry[]>([]);
  const [loadingFacultySchedule, setLoadingFacultySchedule] = useState(false);
  const [selectedFacultyDay, setSelectedFacultyDay] = useState("MON");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const facultyCountsByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of facultyScheduleEntries) counts[s.dayOfWeek] = (counts[s.dayOfWeek] ?? 0) + 1;
    return counts;
  }, [facultyScheduleEntries]);

  const facultyTodaysSchedule = useMemo(() => {
    return facultyScheduleEntries.filter((s) => s.dayOfWeek === selectedFacultyDay);
  }, [facultyScheduleEntries, selectedFacultyDay]);

  useEffect(() => {
    async function loadData() {
      try {
        const [meRes, statsRes, facRes] = await Promise.all([
          api.get("/auth/me"),
          api.get("/hod/stats"),
          api.get("/hod/faculty")
        ]);

        if (meRes.data) {
          setHodName(meRes.data.full_name || meRes.data.display_name || "Dr. HOD");
          setHodDept(meRes.data.department || "Department of CSE");
        }

        if (statsRes.data) {
          setStats(statsRes.data);
        }

        if (facRes.data && Array.isArray(facRes.data)) {
          const mappedList: FacultyListItem[] = facRes.data.map((item: any) => ({
            id: item.id,
            fullName: item.full_name || item.display_name || "Faculty",
            department: item.department || "General",
            isActive: item.is_active ?? true,
            email: item.email || "",
          }));
          setFaculty(mappedList);
        }
      } catch (err) {
        console.error("Failed to fetch live HOD data, falling back to mock data", err);
        setFaculty(mockFacultyList);
        setStats(mockHodStats);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const filtered = faculty.filter((f) => f.fullName.toLowerCase().includes(search.toLowerCase()));

  async function toggleFacultyStatus(id: string, currentStatus: boolean) {
    try {
      const newStatus = !currentStatus;
      await api.patch(`/hod/faculty/${id}/status`, { isActive: newStatus });
      setFaculty((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: newStatus } : p)));
    } catch (err) {
      console.error("Failed to update status on backend, applying locally", err);
      setFaculty((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)));
    }
  }

  async function handleDownloadFacultyTimetable(facultyId: string, fullName: string) {
    try {
      const response = await api.get(`/hod/faculty/${facultyId}/export/excel`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${fullName}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Failed to download faculty timetable", err);
      alert("Could not download timetable. Ensure the database has schedule entries for this faculty.");
    }
  }

  async function handleDownloadAllFacultyTimetables() {
    try {
      const response = await api.get("/hod/export/all-faculty", {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "all_faculty_timetables.xlsx");
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Failed to download all timetables", err);
      alert("Failed to export all timetables. Ensure the database has active schedules.");
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const toggleSheetSelection = (fileIdx: number, sheetName: string) => {
    setPendingUploads((prev) => {
      const updated = [...prev];
      const file = { ...updated[fileIdx] };
      if (file.selectedSheets.includes(sheetName)) {
        file.selectedSheets = file.selectedSheets.filter((s: string) => s !== sheetName);
      } else {
        file.selectedSheets = [...file.selectedSheets, sheetName];
      }
      updated[fileIdx] = file;
      return updated;
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }

      const { data } = await api.post("/uploads/analyze", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (data.files && data.files.length > 0) {
        // Pre-check sheets that have a legend and look like actual timetables, uncheck the rest
        const formatted = data.files.map((file: any) => ({
          ...file,
          selectedSheets: file.sheets
            .filter((s: any) => s.hasLegend)
            .map((s: any) => s.name),
        }));
        setPendingUploads(formatted);
        setShowSelectionModal(true);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.error || "Failed to analyze timetable files.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleConfirmSelections = async () => {
    const selections = pendingUploads.map((file) => ({
      tempPath: file.tempPath,
      originalName: file.originalName,
      selectedSheets: file.selectedSheets,
    })).filter((s) => s.selectedSheets.length > 0);

    if (selections.length === 0) {
      alert("Please select at least one sheet to import.");
      return;
    }

    setIsApplyingSelections(true);
    try {
      const { data } = await api.post("/uploads/confirm", { selections });
      alert(`Successfully imported ${data.sheetsCount} sheet(s) into the database! Individual timetables have been generated.`);
      setShowSelectionModal(false);

      // Reload HOD data
      setLoading(true);
      const [statsRes, facRes] = await Promise.all([
        api.get("/hod/stats"),
        api.get("/hod/faculty")
      ]);
      if (statsRes.data) setStats(statsRes.data);
      if (facRes.data && Array.isArray(facRes.data)) {
        setFaculty(facRes.data.map((item: any) => ({
          id: item.id,
          fullName: item.full_name || item.display_name || "Faculty",
          department: item.department || "General",
          isActive: item.is_active ?? true,
          email: item.email || "",
        })));
      }
    } catch (err: any) {
      console.error(err);
      alert(err.response?.data?.error || "Failed to import selected timetable sheets.");
    } finally {
      setIsApplyingSelections(false);
      setPendingUploads([]);
    }
  };

  const handleResetDatabase = async () => {
    if (!confirm("Are you sure you want to reset the database? This will permanently delete all schedules, classes, subjects, rooms, and faculty accounts. This action cannot be undone.")) {
      return;
    }
    
    setLoading(true);
    try {
      await api.post("/hod/reset");
      alert("Database reset successfully! All schedules and faculty accounts have been cleared.");
      
      // Reload stats and clear faculty list
      const [statsRes] = await Promise.all([
        api.get("/hod/stats"),
      ]);
      if (statsRes.data) setStats(statsRes.data);
      setFaculty([]);
    } catch (err: any) {
      console.error(err);
      alert("Failed to reset database.");
    } finally {
      setLoading(false);
    }
  };

  const handleFacultyClick = async (fac: FacultyListItem) => {
    setSelectedFacultySchedule(fac);
    setLoadingFacultySchedule(true);
    const todayKey = DAY_ORDER[(new Date().getDay() + 6) % 7];
    setSelectedFacultyDay(todayKey);

    try {
      const { data } = await api.get(`/hod/faculty/${fac.id}/schedule`);
      if (Array.isArray(data)) {
        const mapped: ScheduleEntry[] = data.map((r: any) => {
          const [startRaw, endRaw] = (r.time_label || "").split("-");
          const formatTime = (raw: string) => {
            if (!raw) return "00:00";
            return raw.trim().replace(".", ":");
          };
          return {
            dayOfWeek: r.day_of_week,
            timeLabel: r.time_label,
            startTime: formatTime(startRaw),
            endTime: formatTime(endRaw),
            subjectName: r.subject_name || "—",
            className: r.class_name,
            roomNumber: r.room_number,
          };
        });
        setFacultyScheduleEntries(mapped);
      } else {
        setFacultyScheduleEntries([]);
      }
    } catch (err) {
      console.error("Failed to load faculty schedule", err);
      setFacultyScheduleEntries([]);
    } finally {
      setLoadingFacultySchedule(false);
    }
  };


  const activeStats = stats || mockHodStats;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 md:py-10">
      <AppHeader name="" department="" />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Overview</h1>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
          accept=".xlsx,.xls"
          multiple
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleResetDatabase}
            className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 border border-red-500/30 dark:border-red-500/20 text-red-500 font-medium hover:bg-red-500/10 transition-colors text-xs"
          >
            Reset Database
          </button>
          <button
            onClick={handleDownloadAllFacultyTimetables}
            className="inline-flex items-center gap-2 rounded-2xl px-4 py-2 border border-indigo-500/30 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-300 font-medium hover:bg-indigo-500/10 transition-colors text-xs"
          >
            <Download size={14} /> Download All Timetables
          </button>
          <button
            onClick={handleUploadClick}
            className="inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-white font-medium shadow-glass hover:opacity-90 transition-opacity text-xs"
            style={{ background: "var(--gradient-hero)" }}
          >
            <Upload size={16} /> Upload Timetable
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {STAT_CARDS.map((s, idx) => (
          <GlassCard key={s.key} className="!p-5" transition={{ delay: idx * 0.05 }}>
            <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center text-white mb-3`}>
              <s.icon size={18} />
            </div>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">
              {loading ? "..." : activeStats[s.key]}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800 dark:text-white">Faculty Management</h2>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search faculty..."
              className="pl-9 pr-3 py-2 rounded-xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="text-center py-10 text-slate-500 dark:text-slate-400">Loading faculty list...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-500 dark:text-slate-400">No faculty found.</div>
          ) : (
            filtered.map((f, idx) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                onClick={() => handleFacultyClick(f)}
                className="flex items-center justify-between rounded-2xl px-4 py-3 bg-white/50 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-300 font-semibold text-sm">
                    {f.fullName.replace(/^(Mr|Mrs|Dr|Ms)\.?/, "").trim()[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-white">{f.fullName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadFacultyTimetable(f.id, f.fullName);
                    }}
                    className="h-8 px-3 rounded-xl glass-card text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/10 flex items-center gap-1.5 text-xs font-medium transition-colors"
                  >
                    <Download size={14} /> Timetable
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFacultyStatus(f.id, f.isActive);
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium"
                  >
                    {f.isActive ? (
                      <ToggleRight className="text-emerald-500" size={22} />
                    ) : (
                      <ToggleLeft className="text-slate-400" size={22} />
                    )}
                    <span className={f.isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>
                      {f.isActive ? "Active" : "Disabled"}
                    </span>
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </GlassCard>

      {/* Uploading Loading Overlay */}
      {isUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
          <div className="glass-card max-w-sm p-8 flex flex-col items-center justify-center gap-3 text-center shadow-2xl border border-white/20 dark:border-white/10">
            <div className="h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <h3 className="font-semibold text-slate-800 dark:text-white mt-4">Importing Timetable...</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Uploading file, parsing all sheets, and generating individual timetables for faculty members.</p>
          </div>
        </div>
      )}

      {/* Faculty Timetable Viewer Modal */}
      {selectedFacultySchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 overflow-y-auto">
          <div className="glass-card w-full max-w-4xl p-6 flex flex-col gap-4 shadow-2xl border border-white/20 dark:border-white/10 max-h-[90vh] text-left">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                  {selectedFacultySchedule.fullName}'s Timetable
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadFacultyTimetable(selectedFacultySchedule.id, selectedFacultySchedule.fullName)}
                  className="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 text-xs font-semibold shadow-glass transition-colors"
                >
                  <Download size={14} /> Download Timetable
                </button>
                <button
                  onClick={() => setSelectedFacultySchedule(null)}
                  className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                >
                  ✕
                </button>
              </div>
            </div>

            {loadingFacultySchedule ? (
              <div className="py-20 text-center text-slate-500 dark:text-slate-400">
                Loading schedule entries...
              </div>
            ) : facultyScheduleEntries.length === 0 ? (
              <div className="py-20 text-center text-slate-500 dark:text-slate-400">
                No schedule periods assigned yet.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <WeekStrip
                  selected={selectedFacultyDay}
                  onSelect={setSelectedFacultyDay}
                  countsByDay={facultyCountsByDay}
                />
                
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mt-2">
                  {selectedFacultyDay}
                </div>

                <div className="max-h-[350px] overflow-y-auto pr-1">
                  <DayTimeline entries={facultyTodaysSchedule} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Sheet Selection Modal */}
      {showSelectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 overflow-y-auto">
          <div className="glass-card w-full max-w-2xl p-6 flex flex-col gap-4 shadow-2xl border border-white/20 dark:border-white/10 max-h-[85vh] text-left">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                  Select Sheets to Import
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Choose which sheets to import. Helper/summary sheets without legends are unchecked by default.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowSelectionModal(false);
                  setPendingUploads([]);
                }}
                className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 my-2 pr-1">
              {pendingUploads.map((file, fileIdx) => (
                <div key={file.tempPath} className="space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <div className="h-6 w-6 rounded bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
                      {fileIdx + 1}
                    </div>
                    <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300 truncate">
                      {file.originalName}
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-2">
                    {file.sheets.map((sheet: any) => {
                      const isChecked = file.selectedSheets.includes(sheet.name);
                      return (
                        <label
                          key={sheet.name}
                          className={`flex items-center justify-between rounded-xl p-3 border transition-all cursor-pointer ${
                            isChecked
                              ? "bg-indigo-50/30 dark:bg-indigo-500/5 border-indigo-500/30 dark:border-indigo-500/20"
                              : "bg-white/40 dark:bg-white/5 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSheetSelection(fileIdx, sheet.name)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                            />
                            <div className="text-left">
                              <p className="text-sm font-medium text-slate-800 dark:text-white truncate max-w-[150px]">
                                {sheet.name}
                              </p>
                              {sheet.classLabel && (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {sheet.classLabel}
                                </p>
                              )}
                            </div>
                          </div>
                          <div>
                            {sheet.hasLegend ? (
                              <span className="inline-flex items-center rounded-md bg-green-500/10 px-2 py-1 text-2xs font-medium text-green-700 dark:text-green-300">
                                Has Legend
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-1 text-2xs font-medium text-amber-700 dark:text-amber-400">
                                No Legend
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-3">
              <button
                onClick={() => {
                  setShowSelectionModal(false);
                  setPendingUploads([]);
                }}
                className="rounded-xl px-4 py-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSelections}
                disabled={isApplyingSelections}
                className="rounded-xl px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-glass transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isApplyingSelections ? (
                  <>
                    <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Importing...
                  </>
                ) : (
                  "Confirm & Import"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

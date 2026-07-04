import { motion } from "framer-motion";
import { CheckCircle2, MapPin, FlaskConical } from "lucide-react";
import { ScheduleEntry } from "../types";

const STATUS_STYLES: Record<string, string> = {
  completed: "border-slate-200 dark:border-slate-700 opacity-60",
  current: "border-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.15)] animate-pulse-glow",
  upcoming: "border-slate-200 dark:border-slate-700",
};

export function DayTimeline({ entries }: { entries: ScheduleEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="glass-card p-10 text-center text-slate-500 dark:text-slate-400">
        <p className="text-lg font-medium">You're free this afternoon 🌤️</p>
        <p className="text-sm mt-1">Enjoy your free period.</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-5">Today's Timeline</h3>
      <div className="relative pl-6 border-l-2 border-dashed border-slate-200 dark:border-slate-700 space-y-5">
        {entries.map((e, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.06 }}
            className="relative"
          >
            <span
              className={`absolute -left-[31px] top-2 h-3.5 w-3.5 rounded-full border-2 bg-white dark:bg-slate-900 ${
                e.status === "current" ? "border-indigo-500" : "border-slate-300 dark:border-slate-600"
              }`}
            />
            <div
              className={`rounded-2xl border-2 bg-white/70 dark:bg-white/5 backdrop-blur-md p-4 flex items-center justify-between gap-4 ${STATUS_STYLES[e.status ?? "upcoming"]}`}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-300">
                  {e.isLab ? <FlaskConical size={18} /> : <span className="font-bold text-sm">{e.subjectName[0]}</span>}
                </div>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-white text-sm">{e.subjectName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <MapPin size={12} /> {e.className} · Room {e.roomNumber}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{e.timeLabel}</p>
                {e.status === "completed" && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={12} /> Done
                  </span>
                )}
                {e.status === "current" && (
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Now</span>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

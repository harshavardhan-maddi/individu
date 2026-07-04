import { motion } from "framer-motion";

const DAYS: { key: string; label: string }[] = [
  { key: "MON", label: "Mon" },
  { key: "TUE", label: "Tue" },
  { key: "WED", label: "Wed" },
  { key: "THU", label: "Thu" },
  { key: "FRI", label: "Fri" },
  { key: "SAT", label: "Sat" },
];

export function WeekStrip({
  selected,
  onSelect,
  countsByDay,
}: {
  selected: string;
  onSelect: (day: string) => void;
  countsByDay?: Record<string, number>;
}) {
  return (
    <div className="glass-card p-3">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {DAYS.map((d) => {
          const active = d.key === selected;
          return (
            <motion.button
              key={d.key}
              onClick={() => onSelect(d.key)}
              whileTap={{ scale: 0.95 }}
              className={`relative flex-1 min-w-[64px] rounded-2xl px-3 py-3 text-sm font-medium transition-colors ${
                active
                  ? "text-white"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              {active && (
                <motion.div
                  layoutId="week-strip-active"
                  className="absolute inset-0 rounded-2xl"
                  style={{ background: "var(--gradient-hero)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{d.label}</span>
              {countsByDay?.[d.key] !== undefined && (
                <span className={`relative z-10 block text-xs mt-0.5 ${active ? "text-indigo-100" : "text-slate-400"}`}>
                  {countsByDay[d.key]} classes
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

import { motion } from "framer-motion";
import { Clock, MapPin, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { ScheduleEntry } from "../types";

interface HeroCardProps {
  facultyName: string;
  totalClassesToday: number;
  next: ScheduleEntry | null;
}

function useCountdown(targetTime: string | undefined) {
  const [label, setLabel] = useState("—");
  useEffect(() => {
    if (!targetTime) return;
    const update = () => {
      const [h, m] = targetTime.split(":").map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);
      const diffMs = target.getTime() - Date.now();
      if (diffMs <= 0) return setLabel("Starting now");
      const mins = Math.floor(diffMs / 60000);
      setLabel(mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [targetTime]);
  return label;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export function HeroCard({ facultyName, totalClassesToday, next }: HeroCardProps) {
  const countdown = useCountdown(next?.startTime);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-3xl p-8 text-white shadow-glass-lg"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-cyan-300/20 blur-2xl" />

      <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-indigo-100/90 text-sm font-medium">{greeting()},</p>
          <h1 className="text-3xl font-bold mt-1">{facultyName.replace(/^Mr\.|^Mrs\.|^Dr\./, "").trim()}</h1>
          <p className="mt-2 text-indigo-100/90">
            {totalClassesToday > 0
              ? `You have ${totalClassesToday} class${totalClassesToday > 1 ? "es" : ""} today`
              : "No classes today 🎉"}
          </p>
        </div>

        {next && (
          <div className="rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 p-5 min-w-[240px]">
            <p className="text-xs uppercase tracking-wide text-indigo-100/80 font-semibold">Next Class</p>
            <div className="mt-2 flex items-center gap-2 text-lg font-bold">
              <Clock size={18} /> {next.timeLabel.split("-")[0].trim()}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-indigo-50">
              <BookOpen size={14} /> {next.subjectName}
            </div>
            <div className="flex items-center gap-2 text-sm text-indigo-50">
              <MapPin size={14} /> {next.className} · Room {next.roomNumber}
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
              Starts in {countdown}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

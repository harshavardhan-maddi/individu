import { Bell, Moon, Sun, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function AppHeader({ name, department }: { name: string; department: string }) {
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(new Date());
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    navigate("/login");
  };

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <header className="flex items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        {name ? (
          <>
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold shadow-glass">
              {name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </div>
            <div>
              <p className="font-semibold text-slate-800 dark:text-white leading-tight">{name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{department}</p>
            </div>
          </>
        ) : (
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-500 to-cyan-400 bg-clip-text text-transparent">
            Faculty Scheduler Pro
          </h1>
        )}
      </div>

      <div className="hidden sm:flex flex-col items-end mr-auto ml-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <p className="text-xs text-slate-400">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      </div>

      <div className="flex items-center gap-2">
        <button className="relative h-10 w-10 rounded-xl glass-card !p-0 flex items-center justify-center text-slate-600 dark:text-slate-300">
          <Bell size={18} />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-rose-500" />
        </button>
        <button
          onClick={() => setDark((d) => !d)}
          className="h-10 w-10 rounded-xl glass-card !p-0 flex items-center justify-center text-slate-600 dark:text-slate-300"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {name && (
          <button
            onClick={handleLogout}
            className="h-10 w-10 rounded-xl glass-card !p-0 flex items-center justify-center text-slate-600 dark:text-slate-300"
          >
            <LogOut size={18} />
          </button>
        )}
      </div>
    </header>
  );
}

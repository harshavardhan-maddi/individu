import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Lock, Mail } from "lucide-react";
import { api } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      navigate(data.role === "hod" ? "/hod" : "/dashboard");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass-card w-full max-w-sm p-8"
      >
        <div
          className="h-12 w-12 rounded-2xl mb-5 flex items-center justify-center text-white font-bold"
          style={{ background: "var(--gradient-hero)" }}
        >
          FS
        </div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-white">Faculty Scheduler Pro</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">Sign in to view your schedule</p>

        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Email / ID</label>
        <div className="relative mb-4">
          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Email or ID"
          />
        </div>

        <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Password</label>
        <div className="relative mb-2">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-slate-700 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-4 rounded-xl py-2.5 text-white font-medium shadow-glass disabled:opacity-60"
          style={{ background: "var(--gradient-hero)" }}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </motion.form>
    </div>
  );
}

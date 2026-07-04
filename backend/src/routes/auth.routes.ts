import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../config/db.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid email or password format" });

  const { email, password } = parsed.data;
  const { rows } = await pool.query(
    `SELECT u.id, u.password_hash, u.role, u.is_active, u.must_reset_password, f.id as faculty_id
     FROM users u LEFT JOIN faculty f ON f.user_id = u.id
     WHERE u.email = $1`,
    [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: "Invalid credentials or account disabled" });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

  const payload = { userId: user.id, role: user.role, facultyId: user.faculty_id ?? undefined };
  res.json({
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    mustResetPassword: user.must_reset_password,
    role: user.role,
  });
});

authRouter.post("/refresh", (req, res) => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
  try {
    const payload = verifyRefreshToken(refreshToken);
    res.json({ accessToken: signAccessToken(payload) });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(), // optional on forced first reset
  newPassword: z.string().min(8),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "newPassword must be at least 8 characters" });

  const { rows } = await pool.query(`SELECT password_hash, must_reset_password FROM users WHERE id = $1`, [
    req.user!.userId,
  ]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!user.must_reset_password) {
    const valid = parsed.data.currentPassword
      ? await bcrypt.compare(parsed.data.currentPassword, user.password_hash)
      : false;
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await pool.query(`UPDATE users SET password_hash = $1, must_reset_password = false WHERE id = $2`, [
    newHash,
    req.user!.userId,
  ]);
  res.json({ success: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, f.id as faculty_id, f.full_name, f.display_name, f.avatar_url, d.name as department
     FROM users u
     LEFT JOIN faculty f ON f.user_id = u.id
     LEFT JOIN departments d ON d.id = f.department_id
     WHERE u.id = $1`,
    [req.user!.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: "User not found" });
  res.json(rows[0]);
});

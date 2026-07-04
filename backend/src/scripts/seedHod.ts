/**
 * Creates the first HOD account so you have a way to log in at all.
 * Usage: tsx src/scripts/seedHod.ts hod@college.edu MyPassword123
 */
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: tsx src/scripts/seedHod.ts <email> <password>");
  process.exit(1);
}

const run = async () => {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, must_reset_password)
     VALUES ($1, $2, 'hod', false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, hash]
  );
  console.log(`HOD account ready: ${email}`);
  await pool.end();
};

run();

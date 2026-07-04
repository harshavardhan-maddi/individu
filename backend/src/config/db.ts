import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render/Heroku-style managed Postgres often needs SSL; toggle via env.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error", err);
});

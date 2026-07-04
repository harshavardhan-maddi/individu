import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth.routes.js";
import { uploadRouter } from "./routes/upload.routes.js";
import { facultyRouter } from "./routes/faculty.routes.js";
import { hodRouter } from "./routes/hod.routes.js";

dotenv.config();

export const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadRouter);
app.use("/api/faculty", facultyRouter);
app.use("/api/hod", hodRouter);

// Central error handler (multer errors, uncaught route errors, etc.)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
});

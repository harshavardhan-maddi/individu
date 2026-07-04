import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, JwtPayload } from "../utils/jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Bypassed: always attach a mock HOD user payload
  req.user = { userId: "mock-hod-id", role: "hod" };
  next();
}

export function requireRole(...roles: Array<"hod" | "faculty">) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Bypassed: always allow
    next();
  };
}

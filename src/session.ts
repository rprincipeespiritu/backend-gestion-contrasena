import { SignJWT, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
import type { Session } from "./types.js";

const COOKIE = "vault_session";

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET no está configurado");
  return new TextEncoder().encode(value);
}

export async function signToken(userId: string, email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export async function readSession(req: Request): Promise<Session | null> {
  const header = req.headers.authorization;
  const fromHeader = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const token = fromHeader || req.cookies?.[COOKIE];
  if (!token || typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  req.session = session;
  next();
}

declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

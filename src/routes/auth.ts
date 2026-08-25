import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { clearSessionCookie, readSession, setSessionCookie, signToken } from "../session.js";
import {
  avatarKey,
  isAllowedImageType,
  isAvatarKey,
  presignDownload,
  presignUpload,
  s3Enabled,
} from "../s3.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const authRouter = Router();

authRouter.post("/prelogin", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    res.status(400).json({ error: "Email requerido" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      kdfSalt: true,
      kdfIterations: true,
      recoverySalt: true,
      recoveryIterations: true,
    },
  });
  if (!user) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }
  res.json({
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    hasRecovery: Boolean(user.recoverySalt),
    recoverySalt: user.recoverySalt,
    recoveryIterations: user.recoveryIterations,
  });
});

authRouter.post("/register", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const authHash = String(req.body?.authHash ?? "");
  const kdfSalt = String(req.body?.kdfSalt ?? "");
  const kdfIterations = Number(req.body?.kdfIterations ?? 0);
  const protectedVaultKey = String(req.body?.protectedVaultKey ?? "");

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Email no válido" });
    return;
  }
  if (!authHash || !kdfSalt || !protectedVaultKey) {
    res.status(400).json({ error: "Faltan datos de cifrado" });
    return;
  }
  if (kdfIterations < 100_000 || kdfIterations > 1_000_000) {
    res.status(400).json({ error: "Iteraciones KDF no válidas" });
    return;
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ error: "Ya existe una cuenta con ese email" });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      authHash: await bcrypt.hash(authHash, 12),
      kdfSalt,
      kdfIterations,
      protectedVaultKey,
    },
  });

  const token = await signToken(user.id, user.email);
  setSessionCookie(res, token);
  res.json({
    token,
    user: { id: user.id, email: user.email },
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    protectedVaultKey: user.protectedVaultKey,
  });
});

authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const authHash = String(req.body?.authHash ?? "");
  if (!email || !authHash) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(authHash, user.authHash))) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  const token = await signToken(user.id, user.email);
  setSessionCookie(res, token);
  res.json({
    token,
    user: { id: user.id, email: user.email },
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    protectedVaultKey: user.protectedVaultKey,
  });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      kdfSalt: true,
      kdfIterations: true,
      protectedVaultKey: true,
      recoveryBlob: true,
      recoverySalt: true,
      recoveryIterations: true,
      avatarKey: true,
    },
  });
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  let avatarUrl: string | null = null;
  if (user.avatarKey) {
    try {
      avatarUrl = await presignDownload(user.avatarKey);
    } catch {
      avatarUrl = null;
    }
  }

  res.json({
    user: { id: user.id, email: user.email, avatarUrl },
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    protectedVaultKey: user.protectedVaultKey,
    hasRecovery: Boolean(user.recoveryBlob),
    recoveryBlob: user.recoveryBlob,
    recoverySalt: user.recoverySalt,
    recoveryIterations: user.recoveryIterations,
  });
});

authRouter.put("/recovery", async (req, res) => {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const recoveryAuthHash = String(req.body?.recoveryAuthHash ?? "");
  const recoverySalt = String(req.body?.recoverySalt ?? "");
  const recoveryBlob = String(req.body?.recoveryBlob ?? "");
  const recoveryIterations = Number(req.body?.recoveryIterations ?? 0);
  if (!recoveryAuthHash || !recoverySalt || !recoveryBlob || recoveryIterations < 100_000) {
    res.status(400).json({ error: "Datos de recuperación no válidos" });
    return;
  }
  await prisma.user.update({
    where: { id: session.userId },
    data: {
      recoveryAuthHash: await bcrypt.hash(recoveryAuthHash, 12),
      recoverySalt,
      recoveryBlob,
      recoveryIterations,
    },
  });
  res.json({ ok: true });
});

authRouter.post("/login-recovery", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const authHash = String(req.body?.authHash ?? "");
  if (!email || !authHash) {
    res.status(401).json({ error: "Código de recuperación incorrecto" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.recoveryAuthHash || !user.recoveryBlob) {
    res.status(401).json({ error: "Código de recuperación incorrecto" });
    return;
  }
  const ok = await bcrypt.compare(authHash, user.recoveryAuthHash);
  if (!ok) {
    res.status(401).json({ error: "Código de recuperación incorrecto" });
    return;
  }
  const token = await signToken(user.id, user.email);
  setSessionCookie(res, token);
  res.json({
    token,
    user: { id: user.id, email: user.email },
    kdfSalt: user.recoverySalt,
    kdfIterations: user.recoveryIterations,
    protectedVaultKey: user.recoveryBlob,
  });
});

authRouter.post("/avatar/url", async (req, res) => {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!s3Enabled()) {
    res.status(503).json({ error: "S3 no está configurado. Completa AWS_* y S3_BUCKET en backend/.env" });
    return;
  }
  const contentType = String(req.body?.contentType ?? "");
  if (!isAllowedImageType(contentType)) {
    res.status(400).json({ error: "Usa JPG, PNG, WEBP o GIF" });
    return;
  }
  try {
    const key = avatarKey(session.userId, contentType);
    const uploadUrl = await presignUpload(key, contentType);
    res.json({ key, uploadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo preparar la subida";
    res.status(500).json({ error: message });
  }
});

authRouter.put("/avatar", async (req, res) => {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const key = String(req.body?.key ?? "");
  if (!isAvatarKey(key, session.userId)) {
    res.status(400).json({ error: "Clave de archivo no válida" });
    return;
  }
  await prisma.user.update({
    where: { id: session.userId },
    data: { avatarKey: key },
  });
  let avatarUrl: string | null = null;
  try {
    avatarUrl = await presignDownload(key);
  } catch {
    avatarUrl = null;
  }
  res.json({ avatarUrl });
});

import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../session.js";

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

foldersRouter.get("/", async (req, res) => {
  const folders = await prisma.folder.findMany({
    where: { userId: req.session!.userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, nameCipher: true },
  });
  res.json({ folders });
});

foldersRouter.post("/", async (req, res) => {
  const nameCipher = String(req.body?.nameCipher ?? "");
  if (!nameCipher) {
    res.status(400).json({ error: "Nombre cifrado requerido" });
    return;
  }
  const folder = await prisma.folder.create({
    data: { userId: req.session!.userId, nameCipher },
    select: { id: true, nameCipher: true },
  });
  res.json({ folder });
});

foldersRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.folder.findFirst({
    where: { id: req.params.id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Carpeta no encontrada" });
    return;
  }
  const nameCipher = String(req.body?.nameCipher ?? "");
  if (!nameCipher) {
    res.status(400).json({ error: "Nombre cifrado requerido" });
    return;
  }
  const folder = await prisma.folder.update({
    where: { id: existing.id },
    data: { nameCipher },
    select: { id: true, nameCipher: true },
  });
  res.json({ folder });
});

foldersRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.folder.findFirst({
    where: { id: req.params.id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Carpeta no encontrada" });
    return;
  }
  await prisma.folder.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

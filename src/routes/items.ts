import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../session.js";
import { isItemType } from "../types.js";

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

const itemSelect = {
  id: true,
  type: true,
  favorite: true,
  folderId: true,
  cipherBlob: true,
  lastUsedAt: true,
  deletedAt: true,
  updatedAt: true,
} as const;

function serialize(item: {
  id: string;
  type: string;
  favorite: boolean;
  folderId: string | null;
  cipherBlob: string;
  lastUsedAt: Date | null;
  deletedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    ...item,
    lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  };
}

itemsRouter.get("/", async (req, res) => {
  const trash = String(req.query.trash ?? "") === "1";
  const items = await prisma.vaultItem.findMany({
    where: {
      userId: req.session!.userId,
      deletedAt: trash ? { not: null } : null,
    },
    orderBy: { updatedAt: "desc" },
    select: itemSelect,
  });
  res.json({ items: items.map(serialize) });
});

itemsRouter.post("/", async (req, res) => {
  const type = String(req.body?.type ?? "");
  const cipherBlob = String(req.body?.cipherBlob ?? "");
  const folderId = req.body?.folderId ? String(req.body.folderId) : null;
  const favorite = Boolean(req.body?.favorite);

  if (!isItemType(type) || !cipherBlob) {
    res.status(400).json({ error: "Datos de ítem no válidos" });
    return;
  }

  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, userId: req.session!.userId },
    });
    if (!folder) {
      res.status(400).json({ error: "Carpeta no encontrada" });
      return;
    }
  }

  const item = await prisma.vaultItem.create({
    data: {
      userId: req.session!.userId,
      type,
      folderId,
      favorite,
      cipherBlob,
    },
    select: itemSelect,
  });
  res.json({ item: serialize(item) });
});

itemsRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.vaultItem.findFirst({
    where: { id: req.params.id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Ítem no encontrado" });
    return;
  }

  if (req.body?.type && !isItemType(String(req.body.type))) {
    res.status(400).json({ error: "Tipo no válido" });
    return;
  }

  if (req.body?.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: String(req.body.folderId), userId: req.session!.userId },
    });
    if (!folder) {
      res.status(400).json({ error: "Carpeta no encontrada" });
      return;
    }
  }

  const item = await prisma.vaultItem.update({
    where: { id: existing.id },
    data: {
      ...(req.body?.type ? { type: String(req.body.type) } : {}),
      ...(req.body?.cipherBlob ? { cipherBlob: String(req.body.cipherBlob) } : {}),
      ...(typeof req.body?.favorite === "boolean" ? { favorite: req.body.favorite } : {}),
      ...(req.body?.folderId !== undefined
        ? { folderId: req.body.folderId ? String(req.body.folderId) : null }
        : {}),
      ...(req.body?.deletedAt === null ? { deletedAt: null } : {}),
      ...(req.body?.touch === true ? { lastUsedAt: new Date() } : {}),
    },
    select: itemSelect,
  });
  res.json({ item: serialize(item) });
});

itemsRouter.post("/:id/restore", async (req, res) => {
  const existing = await prisma.vaultItem.findFirst({
    where: { id: req.params.id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Ítem no encontrado" });
    return;
  }
  const item = await prisma.vaultItem.update({
    where: { id: existing.id },
    data: { deletedAt: null },
    select: itemSelect,
  });
  res.json({ item: serialize(item) });
});

itemsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.vaultItem.findFirst({
    where: { id: req.params.id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Ítem no encontrado" });
    return;
  }

  if (String(req.query.permanent ?? "") === "1") {
    await prisma.vaultItem.delete({ where: { id: existing.id } });
    res.json({ ok: true, permanent: true });
    return;
  }

  const item = await prisma.vaultItem.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
    select: itemSelect,
  });
  res.json({ item: serialize(item) });
});

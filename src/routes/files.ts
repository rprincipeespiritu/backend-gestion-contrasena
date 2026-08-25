import { Router } from "express";
import { requireAuth } from "../session.js";
import {
  deleteObject,
  fileObjectKey,
  isFileKey,
  presignDownload,
  presignUpload,
  s3Enabled,
} from "../s3.js";

export const filesRouter = Router();
filesRouter.use(requireAuth);

function requireS3(res: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (s3Enabled()) return true;
  res.status(503).json({
    error: "S3 no está configurado. Completa AWS_* , S3_BUCKET y S3_PREFIX en backend/.env",
  });
  return false;
}

filesRouter.post("/url", async (req, res) => {
  if (!requireS3(res)) return;
  try {
    const key = fileObjectKey(req.session!.userId);
    const uploadUrl = await presignUpload(key, "application/octet-stream");
    res.json({ key, uploadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo preparar la subida";
    res.status(500).json({ error: message });
  }
});

filesRouter.post("/download-url", async (req, res) => {
  if (!requireS3(res)) return;
  const key = String(req.body?.key ?? "");
  if (!isFileKey(key, req.session!.userId)) {
    res.status(400).json({ error: "Clave de archivo no válida" });
    return;
  }
  try {
    const downloadUrl = await presignDownload(key);
    res.json({ downloadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo preparar la descarga";
    res.status(500).json({ error: message });
  }
});

filesRouter.delete("/", async (req, res) => {
  if (!requireS3(res)) return;
  const key = String(req.query.key ?? req.body?.key ?? "");
  if (!isFileKey(key, req.session!.userId)) {
    res.status(400).json({ error: "Clave de archivo no válida" });
    return;
  }
  try {
    await deleteObject(key);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo eliminar el archivo";
    res.status(500).json({ error: message });
  }
});

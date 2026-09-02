import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import {
  forwardingReady,
  forwardMaskedEmail,
  maskAddress,
  maskEmailDomain,
} from "../mail.js";
import { requireAuth } from "../session.js";

const WORDS = [
  "lago",
  "nube",
  "faro",
  "roble",
  "cava",
  "lima",
  "norte",
  "zeta",
  "coral",
  "bruma",
  "pino",
  "duna",
];

const inbound = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

export const masksRouter = Router();

function randomLocalPart() {
  const word = WORDS[randomBytes(1)[0]! % WORDS.length];
  const n = (randomBytes(2).readUInt16BE(0) % 9000) + 1000;
  return `${word}${n}`;
}

function extractEmail(raw: string) {
  const angle = raw.match(/<([^>]+)>/);
  const value = (angle?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

function serialize(mask: {
  id: string;
  localPart: string;
  label: string | null;
  enabled: boolean;
  createdAt: Date;
}) {
  return {
    id: mask.id,
    localPart: mask.localPart,
    address: maskAddress(mask.localPart),
    label: mask.label,
    enabled: mask.enabled,
    createdAt: mask.createdAt.toISOString(),
  };
}

function inboundAuthorized(req: Request) {
  const expected = process.env.MASK_INBOUND_SECRET?.trim();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const token = String(req.query.token ?? "");
  const header = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  return token === expected || header === expected;
}

masksRouter.post("/inbound", inbound.any(), async (req, res) => {
  if (!inboundAuthorized(req)) {
    res.status(401).json({ error: "Webhook no autorizado" });
    return;
  }

  try {
    const body = req.body as Record<string, string>;
    const envelopeRaw = body.envelope || "";
    let recipients: string[] = [];
    try {
      const envelope = JSON.parse(envelopeRaw) as { to?: string[] };
      recipients = (envelope.to ?? []).map((item) => extractEmail(item)).filter(Boolean);
    } catch {
      recipients = [];
    }
    if (!recipients.length) {
      const toField = String(body.to ?? "");
      for (const part of toField.split(",")) {
        const email = extractEmail(part);
        if (email) recipients.push(email);
      }
    }

    const domain = maskEmailDomain();
    const from = String(body.from ?? "");
    const subject = String(body.subject ?? "");
    const text = String(body.text ?? "");
    const html = String(body.html ?? "");

    for (const recipient of recipients) {
      const [localPart, host] = recipient.split("@");
      if (!localPart || (domain && host !== domain)) continue;
      const mask = await prisma.emailMask.findUnique({
        where: { localPart },
        include: { user: { select: { email: true } } },
      });
      if (!mask?.enabled) continue;
      if (!forwardingReady()) {
        console.warn("Máscara recibida pero el reenvío no está configurado");
        continue;
      }
      await forwardMaskedEmail({
        toUserEmail: mask.user.email,
        alias: maskAddress(mask.localPart),
        from,
        subject,
        text,
        html,
      });
    }
  } catch (err) {
    console.error("Error en inbound de máscaras:", err);
  }

  res.json({ ok: true });
});

masksRouter.use(requireAuth);

masksRouter.get("/", async (req, res) => {
  const masks = await prisma.emailMask.findMany({
    where: { userId: req.session!.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    domain: maskEmailDomain() || null,
    forwardingReady: forwardingReady(),
    masks: masks.map(serialize),
  });
});

masksRouter.post("/", async (req, res) => {
  const label = String(req.body?.label ?? "").trim().slice(0, 80) || null;
  let created = null;
  for (let i = 0; i < 8; i += 1) {
    const localPart = randomLocalPart();
    try {
      created = await prisma.emailMask.create({
        data: { userId: req.session!.userId, localPart, label },
      });
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") {
        const message = err instanceof Error ? err.message : "No se pudo crear la máscara";
        res.status(500).json({ error: message });
        return;
      }
    }
  }
  if (!created) {
    res.status(500).json({ error: "No se pudo generar un alias único" });
    return;
  }
  res.status(201).json(serialize(created));
});

masksRouter.patch("/:id", async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.emailMask.findFirst({
    where: { id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Máscara no encontrada" });
    return;
  }
  const data: { enabled?: boolean; label?: string | null } = {};
  if (typeof req.body?.enabled === "boolean") data.enabled = req.body.enabled;
  if (typeof req.body?.label === "string") {
    data.label = req.body.label.trim().slice(0, 80) || null;
  }
  const updated = await prisma.emailMask.update({ where: { id }, data });
  res.json(serialize(updated));
});

masksRouter.delete("/:id", async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.emailMask.findFirst({
    where: { id, userId: req.session!.userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Máscara no encontrada" });
    return;
  }
  await prisma.emailMask.delete({ where: { id } });
  res.json({ ok: true });
});

import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../db.js";
import {
  canStartTrial,
  paddleConfigured,
  premiumPriceLabel,
  serializePlan,
  trialData,
  trialDays,
} from "../plan.js";
import { requireAuth } from "../session.js";
import {
  constructPaddleEvent,
  createCheckoutTransaction,
  createCustomerPortal,
  isActiveSubscription,
  paddleApiReady,
  subscriptionPeriodEnd,
  type PaddleSubscription,
  type PaddleTransaction,
} from "../paddle.js";

export const billingRouter = Router();

const planFields = {
  plan: true,
  trialEndsAt: true,
  planExpiresAt: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
} as const;

billingRouter.get("/config", (_req, res) => {
  res.json({
    trialDays: trialDays(),
    premiumPriceLabel: premiumPriceLabel(),
    checkoutEnabled: paddleConfigured(),
  });
});

billingRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session!.userId },
    select: planFields,
  });
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  res.json(serializePlan(user));
});

billingRouter.post("/trial", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session!.userId },
    select: planFields,
  });
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!canStartTrial(user)) {
    res.status(400).json({ error: "Esta cuenta ya usó el plan de prueba" });
    return;
  }
  const updated = await prisma.user.update({
    where: { id: req.session!.userId },
    data: trialData(),
    select: planFields,
  });
  res.json(serializePlan(updated));
});

billingRouter.post("/checkout", requireAuth, async (req, res) => {
  const priceId = process.env.PADDLE_PRICE_ID?.trim();
  if (!paddleApiReady() || !priceId) {
    res.status(503).json({
      error: "La suscripción Premium aún no está configurada. Puedes usar el plan de prueba.",
    });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session!.userId },
    select: { email: true, stripeCustomerId: true },
  });
  if (!user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  try {
    const transaction = await createCheckoutTransaction({
      priceId,
      userId: req.session!.userId,
      email: user.email,
      customerId: user.stripeCustomerId,
    });
    if (!transaction.checkout?.url) {
      res.status(500).json({ error: "No se pudo iniciar el pago con Paddle" });
      return;
    }
    res.json({ url: transaction.checkout.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo iniciar el pago";
    res.status(500).json({ error: message });
  }
});

billingRouter.post("/portal", requireAuth, async (req, res) => {
  if (!paddleApiReady()) {
    res.status(503).json({ error: "Paddle no está configurado" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: req.session!.userId },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    res.status(400).json({ error: "No hay una suscripción para gestionar" });
    return;
  }
  try {
    const url = await createCustomerPortal(user.stripeCustomerId);
    res.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo abrir el portal de Paddle";
    res.status(500).json({ error: message });
  }
});

async function applyPaddleSubscription(sub: PaddleSubscription, fallbackUserId?: string) {
  const userId = sub.custom_data?.userId || fallbackUserId;
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ where: { stripeCustomerId: sub.customer_id } });
  if (!user) return;
  const active = isActiveSubscription(sub.status);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan: active ? "premium" : "free",
      stripeCustomerId: sub.customer_id,
      stripeSubscriptionId: active ? sub.id : null,
      planExpiresAt: active ? subscriptionPeriodEnd(sub) : new Date(),
    },
  });
}

export async function handlePaddleWebhook(req: Request, res: Response) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!paddleApiReady() || !secret) {
    res.status(503).json({ error: "Webhook de Paddle no configurado" });
    return;
  }
  const signature = req.headers["paddle-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).json({ error: "Falta la firma de Paddle" });
    return;
  }

  let event;
  try {
    event = constructPaddleEvent(req.body as Buffer, signature, secret);
  } catch {
    res.status(400).json({ error: "Firma de Paddle no válida" });
    return;
  }

  try {
    if (event.event_type === "transaction.completed") {
      const transaction = event.data as PaddleTransaction;
      const userId = transaction.custom_data?.userId;
      if (userId && transaction.customer_id && transaction.subscription_id) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: "premium",
            stripeCustomerId: transaction.customer_id,
            stripeSubscriptionId: transaction.subscription_id,
          },
        });
      }
    }

    if (
      event.event_type === "subscription.created" ||
      event.event_type === "subscription.activated" ||
      event.event_type === "subscription.updated" ||
      event.event_type === "subscription.canceled" ||
      event.event_type === "subscription.past_due"
    ) {
      await applyPaddleSubscription(event.data as PaddleSubscription);
    }
  } catch (err) {
    console.error("Error en webhook de Paddle:", err);
    res.status(500).json({ error: "No se pudo aplicar el evento de Paddle" });
    return;
  }

  res.json({ received: true });
}

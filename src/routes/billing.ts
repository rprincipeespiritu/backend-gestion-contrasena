import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../db.js";
import {
  canStartTrial,
  premiumPriceLabel,
  serializePlan,
  stripeConfigured,
  trialData,
  trialDays,
} from "../plan.js";
import { requireAuth } from "../session.js";
import {
  constructStripeEvent,
  createCheckoutSession,
  createPortalSession,
  retrieveSubscription,
  stripeApiReady,
  stripeId,
  subscriptionPeriodEnd,
  type StripeCheckoutSession,
  type StripeSubscription,
} from "../stripe.js";

export const billingRouter = Router();

function frontendUrl() {
  return (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

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
    checkoutEnabled: stripeConfigured(),
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
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  if (!stripeApiReady() || !priceId) {
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
    const session = await createCheckoutSession({
      priceId,
      userId: req.session!.userId,
      email: user.email,
      customerId: user.stripeCustomerId,
      successUrl: `${frontendUrl()}/plan?checkout=success`,
      cancelUrl: `${frontendUrl()}/plan?checkout=cancel`,
    });
    if (!session.url) {
      res.status(500).json({ error: "No se pudo iniciar el pago" });
      return;
    }
    res.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo iniciar el pago";
    res.status(500).json({ error: message });
  }
});

billingRouter.post("/portal", requireAuth, async (req, res) => {
  if (!stripeApiReady()) {
    res.status(503).json({ error: "Stripe no está configurado" });
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
    const portal = await createPortalSession(user.stripeCustomerId, `${frontendUrl()}/plan`);
    res.json({ url: portal.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo abrir el portal de Stripe";
    res.status(500).json({ error: message });
  }
});

export async function handleStripeWebhook(req: Request, res: Response) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripeApiReady() || !secret) {
    res.status(503).json({ error: "Webhook de Stripe no configurado" });
    return;
  }
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).json({ error: "Falta la firma de Stripe" });
    return;
  }

  let event;
  try {
    event = constructStripeEvent(req.body as Buffer, signature, secret);
  } catch {
    res.status(400).json({ error: "Firma de Stripe no válida" });
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as StripeCheckoutSession;
      const userId = session.client_reference_id || session.metadata?.userId;
      const subId = stripeId(session.subscription);
      const customerId = stripeId(session.customer);
      if (userId && subId && customerId) {
        const sub = await retrieveSubscription(subId);
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan: "premium",
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            planExpiresAt: subscriptionPeriodEnd(sub),
          },
        });
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as StripeSubscription;
      const customerId = stripeId(sub.customer);
      if (customerId) {
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
        if (user) {
          const active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
          await prisma.user.update({
            where: { id: user.id },
            data: {
              plan: active ? "premium" : "free",
              stripeSubscriptionId: active ? sub.id : null,
              planExpiresAt: active ? subscriptionPeriodEnd(sub) : new Date(),
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("Error en webhook de Stripe:", err);
    res.status(500).json({ error: "No se pudo aplicar el evento de Stripe" });
    return;
  }

  res.json({ received: true });
}

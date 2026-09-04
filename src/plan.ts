export type PlanId = "free" | "trial" | "premium";

export type UserPlanFields = {
  plan: string;
  trialEndsAt: Date | null;
  planExpiresAt: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export function trialDays() {
  const n = Number(process.env.TRIAL_DAYS ?? 14);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 90) : 14;
}

export function freeItemLimit() {
  const n = Number(process.env.FREE_ITEM_LIMIT ?? 50);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

export function freeMaskLimit() {
  const n = Number(process.env.FREE_MASK_LIMIT ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function premiumMaskLimit() {
  const n = Number(process.env.PREMIUM_MASK_LIMIT ?? 100);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

export function premiumPriceLabel() {
  return (process.env.PREMIUM_PRICE_LABEL ?? "US$ 4,99 / mes").trim();
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_PRICE_ID?.trim());
}

export function resolvePlan(user: UserPlanFields): PlanId {
  const now = Date.now();
  if (user.plan === "premium") {
    if (!user.planExpiresAt || user.planExpiresAt.getTime() > now) return "premium";
  }
  if (user.plan === "trial" && user.trialEndsAt && user.trialEndsAt.getTime() > now) {
    return "trial";
  }
  return "free";
}

export function hasPremium(user: UserPlanFields) {
  const plan = resolvePlan(user);
  return plan === "premium" || plan === "trial";
}

export function planLabel(plan: PlanId) {
  if (plan === "premium") return "Plan Premium";
  if (plan === "trial") return "Plan de prueba";
  return "Plan gratuito";
}

export function canStartTrial(user: UserPlanFields) {
  return !user.trialEndsAt && resolvePlan(user) === "free";
}

export function trialData() {
  const ends = new Date();
  ends.setDate(ends.getDate() + trialDays());
  return { plan: "trial" as const, trialEndsAt: ends };
}

export function serializePlan(user: UserPlanFields) {
  const plan = resolvePlan(user);
  const premium = hasPremium(user);
  return {
    plan,
    label: planLabel(plan),
    premium,
    trialDays: trialDays(),
    trialEndsAt: user.trialEndsAt?.toISOString() ?? null,
    planExpiresAt: plan === "premium" ? (user.planExpiresAt?.toISOString() ?? null) : null,
    canStartTrial: canStartTrial(user),
    checkoutEnabled: stripeConfigured(),
    portalEnabled: Boolean(user.stripeCustomerId && stripeConfigured()),
    limits: {
      items: premium ? null : freeItemLimit(),
      masks: premium ? premiumMaskLimit() : freeMaskLimit(),
    },
  };
}

export const planSelect = {
  plan: true,
  trialEndsAt: true,
  planExpiresAt: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
} as const;

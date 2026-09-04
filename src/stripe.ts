import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";

type StripeErrorBody = { error?: { message?: string } };

export type StripeCheckoutSession = {
  url?: string | null;
  client_reference_id?: string | null;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  metadata?: { userId?: string } | null;
};

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string | { id: string };
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
};

export type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

function stripeKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
}

export function stripeApiReady() {
  return Boolean(stripeKey());
}

async function stripeRequest<T>(method: "GET" | "POST", path: string, fields?: Record<string, string>) {
  const key = stripeKey();
  if (!key) throw new Error("Falta STRIPE_SECRET_KEY");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: fields ? new URLSearchParams(fields) : undefined,
  });
  const data = (await res.json()) as T & StripeErrorBody;
  if (!res.ok) {
    throw new Error(data.error?.message || "Error de Stripe");
  }
  return data;
}

export function createCheckoutSession(input: {
  priceId: string;
  userId: string;
  email: string;
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}) {
  const fields: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: input.userId,
    "metadata[userId]": input.userId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: "true",
  };
  if (input.customerId) fields.customer = input.customerId;
  else fields.customer_email = input.email;
  return stripeRequest<StripeCheckoutSession>("POST", "/checkout/sessions", fields);
}

export function createPortalSession(customerId: string, returnUrl: string) {
  return stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
}

export function retrieveSubscription(id: string) {
  return stripeRequest<StripeSubscription>("GET", `/subscriptions/${id}`);
}

export function subscriptionPeriodEnd(sub: StripeSubscription) {
  const unix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof unix === "number" ? new Date(unix * 1000) : null;
}

export function stripeId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function constructStripeEvent(rawBody: Buffer | string, signatureHeader: string, secret: string): StripeEvent {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key?.trim() ?? "", rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new Error("Firma de Stripe incompleta");
  }
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Firma de Stripe no válida");
  }
  return JSON.parse(payload) as StripeEvent;
}

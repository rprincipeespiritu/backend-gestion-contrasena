import { createHmac, timingSafeEqual } from "node:crypto";

type PaddleErrorBody = { error?: { detail?: string; code?: string } };
type PaddleEnvelope<T> = { data: T } & PaddleErrorBody;

export type PaddleTransaction = {
  id: string;
  status?: string;
  customer_id?: string | null;
  subscription_id?: string | null;
  custom_data?: { userId?: string } | null;
  checkout?: { url?: string | null } | null;
};

export type PaddleSubscription = {
  id: string;
  status: string;
  customer_id: string;
  custom_data?: { userId?: string } | null;
  current_billing_period?: { ends_at?: string | null } | null;
};

export type PaddleEvent = {
  event_type: string;
  data: Record<string, unknown>;
};

function paddleKey() {
  return process.env.PADDLE_API_KEY?.trim() || "";
}

export function paddleApiReady() {
  return Boolean(paddleKey());
}

function paddleApiBase() {
  const explicit = process.env.PADDLE_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const sandbox = String(process.env.PADDLE_SANDBOX ?? "").toLowerCase();
  if (sandbox === "1" || sandbox === "true") return "https://sandbox-api.paddle.com";
  return "https://api.paddle.com";
}

async function paddleRequest<T>(method: "GET" | "POST", path: string, body?: unknown) {
  const key = paddleKey();
  if (!key) throw new Error("Falta PADDLE_API_KEY");
  const res = await fetch(`${paddleApiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Paddle-Version": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json()) as PaddleEnvelope<T>;
  if (!res.ok) {
    throw new Error(payload.error?.detail || "Error de Paddle");
  }
  return payload.data;
}

export function createCheckoutTransaction(input: {
  priceId: string;
  userId: string;
  email: string;
  customerId?: string | null;
}) {
  return paddleRequest<PaddleTransaction>("POST", "/transactions", {
    items: [{ price_id: input.priceId, quantity: 1 }],
    custom_data: { userId: input.userId },
    ...(input.customerId
      ? { customer_id: input.customerId }
      : { customer: { email: input.email } }),
  });
}

export async function createCustomerPortal(customerId: string) {
  const data = await paddleRequest<{
    urls?: { general?: { href?: string } };
  }>("POST", `/customers/${customerId}/portal-sessions`, {});
  const url = data.urls?.general?.href;
  if (!url) throw new Error("Paddle no devolvió el portal del cliente");
  return url;
}

export function subscriptionPeriodEnd(sub: PaddleSubscription) {
  const ends = sub.current_billing_period?.ends_at;
  if (!ends) return null;
  const date = new Date(ends);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isActiveSubscription(status: string) {
  return status === "active" || status === "trialing" || status === "past_due";
}

export function constructPaddleEvent(rawBody: Buffer | string, signatureHeader: string, secret: string): PaddleEvent {
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key ?? "", rest.join("=")];
    }),
  );
  const timestamp = parts.ts;
  const signature = parts.h1;
  if (!timestamp || !signature) {
    throw new Error("Firma de Paddle incompleta");
  }
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${timestamp}:${payload}`).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Firma de Paddle no válida");
  }
  return JSON.parse(payload) as PaddleEvent;
}

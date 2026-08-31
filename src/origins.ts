function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function parseOriginList(...values: Array<string | undefined>) {
  const seen = new Set<string>();
  const origins: string[] = [];
  for (const value of values) {
    if (!value) continue;
    for (const part of value.split(",")) {
      const origin = normalizeOrigin(part);
      if (!origin || seen.has(origin)) continue;
      seen.add(origin);
      origins.push(origin);
    }
  }
  return origins;
}

export function s3CorsOrigins() {
  return parseOriginList(
    "http://localhost:3000",
    "https://frontend-gestion-contrasena-production.up.railway.app",
    process.env.FRONTEND_URL,
    process.env.S3_CORS_ORIGINS,
  );
}

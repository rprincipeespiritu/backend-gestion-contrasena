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

/** Orígenes desde los que el navegador llama al API (CORS + cookies). */
export function allowedFrontendOrigins() {
  return parseOriginList(
    "http://localhost:3000",
    "https://cifralock.com",
    "https://www.cifralock.com",
    "https://frontend-gestion-contrasena-production.up.railway.app",
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGINS,
  );
}

export function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true;
  return allowedFrontendOrigins().includes(normalizeOrigin(origin));
}

export function s3CorsOrigins() {
  return parseOriginList(...allowedFrontendOrigins(), process.env.S3_CORS_ORIGINS);
}

export function paddleCheckoutConfig() {
  const sandbox = ["1", "true"].includes(String(process.env.PADDLE_SANDBOX ?? "").toLowerCase());
  const environment = sandbox ? "sandbox" : "production";
  const clientToken = process.env.PADDLE_CLIENT_TOKEN?.trim() || "";
  if (!clientToken.startsWith(sandbox ? "test_" : "live_")) return null;
  return { environment, clientToken };
}

export function paddleCheckoutUrl() {
  const frontend = process.env.FRONTEND_URL?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  let url: URL;
  try { url = new URL(frontend); }
  catch { throw new Error("Configura FRONTEND_URL con el dominio del frontend de CifraLock."); }
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && process.env.NODE_ENV !== "production"))) {
    throw new Error("FRONTEND_URL debe usar HTTPS; HTTP solo esta permitido en localhost durante desarrollo.");
  }
  return new URL("/checkout", url.origin).href;
}
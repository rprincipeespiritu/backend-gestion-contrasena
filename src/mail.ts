import sgMail from "@sendgrid/mail";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function frontendUrl() {
  return (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function ownerEmails() {
  return String(process.env.APP_OWNER_EMAIL ?? process.env.OWNER_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export function mailConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

function sender() {
  const email = process.env.SENDGRID_FROM_EMAIL;
  if (!email) throw new Error("Falta SENDGRID_FROM_EMAIL");
  return {
    email,
    name: process.env.SENDGRID_FROM_NAME || "CifraLock",
  };
}

function sendGridErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const body = (error as { response?: { body?: { errors?: { message?: string }[] } } }).response
      ?.body;
    const message = body?.errors?.[0]?.message;
    if (message) return message;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "No se pudo enviar el correo";
}

async function send(msg: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("Falta SENDGRID_API_KEY");
  sgMail.setApiKey(apiKey);
  const [response] = await sgMail.send({
    ...msg,
    from: sender(),
  });
  return response.statusCode;
}

export async function sendWelcomeEmail(email: string) {
  const loginUrl = `${frontendUrl()}/login`;
  const status = await send({
    to: email,
    subject: "Tu cuenta en CifraLock está lista",
    html: `
      <h2>Bienvenido a CifraLock</h2>
      <p>Tu cuenta se creó correctamente.</p>
      <p>Entra cuando quieras:</p>
      <p><a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a></p>
      <p>La contraseña maestra nunca sale de tu navegador. Si la olvidas, no hay forma de recuperar la bóveda.</p>
      <p>Equipo CifraLock</p>
    `,
  });
  console.log("SendGrid welcome status:", status);
}

export async function sendOwnerNewUserEmail(email: string) {
  const to = ownerEmails();
  if (!to.length) {
    console.warn("APP_OWNER_EMAIL no configurado: se omite aviso de nuevo usuario.");
    return;
  }
  const status = await send({
    to,
    replyTo: email,
    subject: `Nuevo usuario registrado en CifraLock: ${email}`,
    html: `
      <h2>Nuevo usuario registrado</h2>
      <p>Se creó una cuenta nueva en CifraLock.</p>
      <ul>
        <li><strong>Email:</strong> ${escapeHtml(email)}</li>
      </ul>
      <p>CifraLock</p>
    `,
  });
  console.log("SendGrid owner new-user notify status:", status);
}

export async function notifyAccountCreated(email: string) {
  if (!mailConfigured()) {
    console.warn("SendGrid no configurado: se omite el correo de bienvenida.");
    return { sent: false, error: "SendGrid no configurado" };
  }

  let sent = true;
  let error: string | undefined;
  try {
    await sendWelcomeEmail(email);
  } catch (err) {
    sent = false;
    error = sendGridErrorMessage(err);
    console.error("Error enviando correo de bienvenida:", err);
  }

  try {
    await sendOwnerNewUserEmail(email);
  } catch (err) {
    console.error("Error enviando aviso de nuevo usuario al dueño:", err);
  }

  return { sent, error };
}

export function maskEmailDomain() {
  return (process.env.MASK_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
}

export function maskAddress(localPart: string) {
  const domain = maskEmailDomain();
  return domain ? `${localPart}@${domain}` : `${localPart}@mask.local`;
}

export function forwardingReady() {
  return mailConfigured() && Boolean(maskEmailDomain());
}

function extractAddress(raw: string) {
  const angle = raw.match(/<([^>]+)>/);
  const value = (angle?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}

export async function forwardMaskedEmail(opts: {
  toUserEmail: string;
  alias: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}) {
  const fromAddr = extractAddress(opts.from) || opts.from;
  const notice = `
    <p style="font-size:13px;color:#64748b">
      Este mensaje llegó a tu máscara <strong>${escapeHtml(opts.alias)}</strong> en CifraLock.
      Al responder, el correo irá a ${escapeHtml(fromAddr)}.
    </p>
    <hr />
  `;
  const body = opts.html?.trim()
    ? opts.html
    : `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(opts.text || "(sin contenido)")}</pre>`;
  const status = await send({
    to: opts.toUserEmail,
    replyTo: fromAddr || undefined,
    subject: `[${opts.alias}] ${opts.subject || "(sin asunto)"}`,
    html: notice + body,
  });
  console.log("SendGrid mask forward status:", status);
}

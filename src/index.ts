import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { filesRouter } from "./routes/files.js";
import { foldersRouter } from "./routes/folders.js";
import { itemsRouter } from "./routes/items.js";
import { masksRouter } from "./routes/masks.js";
import { s3Enabled, s3Prefix } from "./s3.js";
import { forwardingReady, mailConfigured, maskEmailDomain } from "./mail.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const frontend = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.use(
  cors({
    origin: frontend,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "CifraLock API",
    health: "/health",
    frontend: frontend,
    routes: [
      "POST /api/auth/register",
      "POST /api/auth/prelogin",
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "GET  /api/auth/me",
      "POST /api/auth/avatar/url",
      "PUT  /api/auth/avatar",
      "POST /api/files/url",
      "POST /api/files/download-url",
      "DELETE /api/files",
      "GET|POST /api/items",
      "PATCH|DELETE /api/items/:id",
      "GET|POST /api/folders",
      "PATCH|DELETE /api/folders/:id",
      "GET|POST /api/masks",
      "PATCH|DELETE /api/masks/:id",
      "POST /api/masks/inbound",
    ],
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    s3: {
      enabled: s3Enabled(),
      bucket: process.env.S3_BUCKET ?? null,
      prefix: s3Prefix(),
      region: process.env.AWS_REGION ?? null,
    },
    mail: {
      enabled: mailConfigured(),
      masks: {
        domain: maskEmailDomain() || null,
        forwardingReady: forwardingReady(),
      },
    },
  });
});

app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);
app.use("/api/items", itemsRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/masks", masksRouter);

app.listen(port, () => {
  console.log(`API CifraLock en http://localhost:${port}`);
});

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { frontendOrigins } from "./origins.js";
import { authRouter } from "./routes/auth.js";
import { filesRouter } from "./routes/files.js";
import { foldersRouter } from "./routes/folders.js";
import { itemsRouter } from "./routes/items.js";
import { s3Enabled, s3Prefix } from "./s3.js";
import { mailConfigured } from "./mail.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const origins = frontendOrigins();

app.set("trust proxy", 1);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "CifraBox API",
    health: "/health",
    frontend: origins,
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
    },
  });
});

app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);
app.use("/api/items", itemsRouter);
app.use("/api/folders", foldersRouter);

app.listen(port, () => {
  console.log(`API CifraBox en http://localhost:${port}`);
});

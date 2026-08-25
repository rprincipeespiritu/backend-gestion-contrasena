import "dotenv/config";
import { PutBucketCorsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bucket, getS3Client, s3Enabled, s3Prefix } from "./s3.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function describeError(err: unknown) {
  if (!err || typeof err !== "object") return String(err);
  const e = err as {
    name?: string;
    message?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const parts = [
    e.name,
    e.Code,
    e.$metadata?.httpStatusCode ? `HTTP ${e.$metadata.httpStatusCode}` : null,
    e.message,
  ].filter(Boolean);
  return parts.join(" — ") || "UnknownError";
}

async function main() {
  if (!s3Enabled()) {
    throw new Error("Completa AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y S3_BUCKET en backend/.env");
  }

  const s3 = getS3Client();
  const Bucket = bucket();
  const prefix = s3Prefix();
  const keepKey = `${prefix}/.keep`;

  console.log(`Probando PutObject en s3://${Bucket}/${keepKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: keepKey,
      Body: "vault-dev",
      ContentType: "text/plain",
    }),
  );
  console.log("Prefijo accesible.");

  const cors = JSON.parse(readFileSync(join(root, "s3-cors.json"), "utf8")) as {
    AllowedHeaders: string[];
    AllowedMethods: string[];
    AllowedOrigins: string[];
    ExposeHeaders: string[];
    MaxAgeSeconds: number;
  }[];
  console.log("Aplicando CORS…");
  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: { CORSRules: cors },
    }),
  );
  console.log("CORS aplicado para", cors[0]?.AllowedOrigins?.join(", "));
  s3.destroy();
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});

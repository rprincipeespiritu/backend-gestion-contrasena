import "dotenv/config";
import { PutBucketCorsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3CorsOrigins } from "./origins.js";
import { bucket, getS3Client, s3Enabled, s3Prefix } from "./s3.js";

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
    throw new Error(
      "Completa AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y S3_BUCKET",
    );
  }

  const origins = s3CorsOrigins();
  if (!origins.length) {
    throw new Error("Define FRONTEND_URL o S3_CORS_ORIGINS para el CORS de S3");
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
      Body: `vault-${prefix}`,
      ContentType: "text/plain",
    }),
  );
  console.log("Prefijo accesible.");

  console.log("Aplicando CORS…");
  await s3.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedOrigins: origins,
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );
  console.log("CORS aplicado para", origins.join(", "));
  s3.destroy();
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});

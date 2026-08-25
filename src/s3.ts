import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isAllowedImageType(type: string) {
  return type in ALLOWED;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en backend/.env para conectar con S3`);
  }
  return value;
}

export function s3Enabled() {
  return Boolean(
    process.env.AWS_REGION &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.S3_BUCKET,
  );
}

function client() {
  return new S3Client({
    region: requiredEnv("AWS_REGION"),
    credentials: {
      accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
    },
  });
}

function bucket() {
  return requiredEnv("S3_BUCKET");
}

export function avatarKey(userId: string, contentType: string) {
  const ext = ALLOWED[contentType] ?? "jpg";
  return `avatars/${userId}/${randomUUID()}.${ext}`;
}

export async function presignUpload(key: string, contentType: string) {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 60 },
  );
}

export async function presignDownload(key: string) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
    }),
    { expiresIn: 60 * 60 },
  );
}

export function keyBelongsToUser(key: string, userId: string) {
  return key.startsWith(`avatars/${userId}/`);
}

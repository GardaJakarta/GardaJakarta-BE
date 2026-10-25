import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT_URL?.trim();
const region = process.env.S3_REGION?.trim() || "auto";
const bucket = process.env.S3_BUCKET_NAME?.trim();
const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim();

export const storageConfigured = Boolean(endpoint && bucket && accessKeyId && secretAccessKey && publicBaseUrl);

const client = storageConfigured
  ? new S3Client({ endpoint, region, forcePathStyle: false, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } })
  : null;

export async function uploadImage(input: { key: string; body: Uint8Array; contentType: string }) {
  if (!client || !bucket || !publicBaseUrl) throw new Error("S3 storage belum dikonfigurasi.");
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: input.body, ContentType: input.contentType, CacheControl: "public, max-age=31536000, immutable" }));
  return `${publicBaseUrl.replace(/\/+$/, "")}/${input.key}`;
}

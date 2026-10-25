import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT_URL?.trim();
const region = process.env.S3_REGION?.trim() || "auto";
const bucket = process.env.S3_BUCKET_NAME?.trim();
const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

// Railway Buckets are private; files are served through the API proxy instead
// of exposing a public bucket URL.
export const storageConfigured = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);

const client = storageConfigured
  ? new S3Client({ endpoint, region, forcePathStyle: false, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } })
  : null;

export async function uploadImage(input: { key: string; body: Uint8Array; contentType: string }) {
  if (!client || !bucket) throw new Error("S3 storage belum dikonfigurasi.");
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: input.body, ContentType: input.contentType, CacheControl: "public, max-age=31536000, immutable" }));
}

export async function readImage(key: string) {
  if (!client || !bucket) throw new Error("S3 storage belum dikonfigurasi.");
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("Objek gambar tidak ditemukan.");
  return {
    body: Buffer.from(await result.Body.transformToByteArray()),
    contentType: result.ContentType || "application/octet-stream",
    cacheControl: result.CacheControl || "public, max-age=86400",
  };
}

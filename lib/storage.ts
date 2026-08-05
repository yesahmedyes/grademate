import path from "node:path";
import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET_NAME;
if (!BUCKET) throw new Error("S3_BUCKET_NAME is not set");

// Everything this app writes lives under one prefix, so the bucket stays legible and
// an IAM policy can be scoped to `arn:aws:s3:::<bucket>/uploads/*`. The prefix is an
// implementation detail — `uploadedFiles.path` still stores the bare `<uuid>-<name>`.
const PREFIX = "uploads/";

// The SDK reads AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the
// environment itself, and falls back to an instance role in deployment.
const s3 = new S3Client({});

/** Thrown when the object is genuinely absent, as opposed to unreachable. */
export class FileMissingError extends Error {
  constructor(key: string) {
    super(`No such object: ${key}`);
    this.name = "FileMissingError";
  }
}

/** S3 reports an absent key as NoSuchKey, or as 404 NotFound on a HEAD-style miss. */
function isMissing(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/** `rel` is always a generated uuid-name we stored; keep it from escaping the prefix. */
function objectKey(rel: string): string {
  return PREFIX + path.basename(rel);
}

export async function saveFile(
  buf: Buffer,
  originalName: string,
  contentType?: string
): Promise<string> {
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const rel = `${crypto.randomUUID()}-${safe}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey(rel),
      Body: buf,
      ContentLength: buf.length,
      // Self-describing objects, so a console download or presigned URL behaves.
      ContentType: contentType || "application/octet-stream",
    })
  );
  return rel;
}

export async function readFile(rel: string): Promise<Buffer> {
  const key = objectKey(rel);
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) throw new FileMissingError(key);
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (e) {
    if (isMissing(e)) throw new FileMissingError(key);
    throw e; // credentials, network, permissions — callers must not read this as "gone"
  }
}

/** Best-effort delete; a file that's already gone is not an error. */
export async function deleteFile(rel: string): Promise<void> {
  await s3
    .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey(rel) }))
    .catch(() => {});
}

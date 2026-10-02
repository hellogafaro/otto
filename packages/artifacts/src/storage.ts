import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
export interface ArtifactStorage {
  put(key: string, bytes: Uint8Array, sha256: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}
/** Private immutable object storage. Credentials come only from the trusted process configuration. No public URLs. */
export function createS3Storage(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): ArtifactStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 2,
  });
  return {
    async put(key, bytes, sha256) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentLength: bytes.length,
            ContentType: "application/octet-stream",
            IfNoneMatch: "*",
            Metadata: { sha256 },
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("name" in error) ||
          error.name !== "PreconditionFailed"
        )
          throw error;
        const existing = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
        if (
          existing.Metadata?.sha256 !== sha256 ||
          existing.ContentLength !== bytes.length
        )
          throw new Error("Immutable object conflict");
      }
    },
    async get(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      if (
        !response.Body ||
        response.ContentLength === undefined ||
        response.ContentLength > 8 * 1024 * 1024
      )
        throw new Error("Invalid object size");
      return response.Body.transformToByteArray();
    },
  };
}

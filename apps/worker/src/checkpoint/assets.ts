import { createReadStream } from "node:fs";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

let client: S3Client | null = null;

const getClient = () => {
  if (!config.checkpointAssetOssBucket) throw new Error("CHECKPOINT_ASSET_OSS_BUCKET is required for checkpoint assets");
  if (!config.checkpointAssetOssEndpoint) throw new Error("CHECKPOINT_ASSET_OSS_ENDPOINT is required for checkpoint assets");
  if (!config.checkpointAssetOssAccessKeyId || !config.checkpointAssetOssSecretAccessKey) {
    throw new Error("CHECKPOINT_ASSET_OSS_ACCESS_KEY_ID and CHECKPOINT_ASSET_OSS_SECRET_ACCESS_KEY are required for checkpoint assets");
  }
  client ??= new S3Client({
    endpoint: config.checkpointAssetOssEndpoint,
    region: config.checkpointAssetOssRegion,
    credentials: {
      accessKeyId: config.checkpointAssetOssAccessKeyId,
      secretAccessKey: config.checkpointAssetOssSecretAccessKey,
    },
  });
  return client;
};

export const buildAssetObjectKey = (sha256: string) =>
  `checkpoint-assets/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;

export const uploadAssetIfMissing = async (input: {
  filePath: string;
  sha256: string;
  size: number;
  mimeType: string | null;
}) => {
  const Bucket = config.checkpointAssetOssBucket as string;
  const Key = buildAssetObjectKey(input.sha256);
  const s3 = getClient();
  const exists = await s3.send(new HeadObjectCommand({ Bucket, Key })).then(() => true, () => false);
  if (!exists) {
    await s3.send(new PutObjectCommand({
      Bucket,
      Key,
      Body: createReadStream(input.filePath),
      ContentLength: input.size,
      ContentType: input.mimeType ?? undefined,
      Metadata: { sha256: input.sha256 },
    }));
  }
  return Key;
};

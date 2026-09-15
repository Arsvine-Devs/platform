import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { readEnv } from "@arsvine/env";

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
};

export function readObjectStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const values = {
    endpoint: readEnv("S3_ENDPOINT", env),
    region: readEnv("S3_REGION", env),
    accessKeyId: readEnv("S3_ACCESS_KEY_ID", env),
    secretAccessKey: readEnv("S3_SECRET_ACCESS_KEY", env),
    bucket: readEnv("S3_PRIVATE_BUCKET", env),
    forcePathStyle:
      readEnv("S3_FORCE_PATH_STYLE", env)?.toLowerCase() !== "false",
  };
  if (
    [
      values.endpoint,
      values.region,
      values.accessKeyId,
      values.secretAccessKey,
      values.bucket,
    ].some((value) => !value)
  ) {
    return null;
  }
  return values as ObjectStorageConfig;
}

export function createObjectStorage(config: ObjectStorageConfig) {
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  const client = new S3Client(clientConfig);

  return {
    async getText(key: string) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!result.Body) throw new Error(`Object body missing: ${key}`);
      return result.Body.transformToString();
    },
    async putText(key: string, body: string, contentType = "application/json") {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
  };
}

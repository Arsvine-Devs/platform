import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function readObjectStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const values = {
    endpoint: env.S3_ENDPOINT?.trim(),
    region: env.S3_REGION?.trim(),
    accessKeyId: env.S3_ACCESS_KEY_ID?.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim(),
    bucket: env.S3_PRIVATE_BUCKET?.trim(),
  };
  if (Object.values(values).some((value) => !value)) return null;
  return values as ObjectStorageConfig;
}

export function createObjectStorage(config: ObjectStorageConfig) {
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
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

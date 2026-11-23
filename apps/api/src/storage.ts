import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { messagingMode } from './config';

/** Where attachment bytes live. Attachment rows hold only the key. */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** S3-compatible storage: MinIO locally, any S3 API in production. */
class S3Store implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async ensureBucket(log: Logger) {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        log.log(`Created storage bucket "${this.bucket}"`);
      } catch (error) {
        // Production credentials often may not create buckets; uploads will
        // surface the real problem if the bucket is genuinely missing.
        log.warn(
          `Could not verify or create bucket "${this.bucket}": ${(error as Error).message}`,
        );
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // AWS S3 encrypts at rest by default; opt in for providers that need the
        // header. (MinIO rejects it unless a KMS is configured.)
        ServerSideEncryption:
          process.env.S3_SSE === 'AES256' ? 'AES256' : undefined,
      }),
    );
  }

  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await result.Body!.transformToByteArray());
  }
}

/** Simulation-only fallback when no bucket is configured. Lost on restart. */
class MemoryStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>();
  put(key: string, body: Buffer) {
    this.objects.set(key, body);
    return Promise.resolve();
  }
  get(key: string) {
    const body = this.objects.get(key);
    return body
      ? Promise.resolve(body)
      : Promise.reject(new Error(`No stored object ${key}`));
  }
}

@Injectable()
export class StorageService implements OnModuleInit, ObjectStore {
  private readonly log = new Logger('Storage');
  private store: ObjectStore;
  readonly kind: 's3' | 'memory';

  constructor() {
    const bucket = process.env.S3_BUCKET?.trim();
    if (bucket) {
      const client = new S3Client({
        endpoint: process.env.S3_ENDPOINT || undefined,
        region: process.env.S3_REGION || 'us-east-1',
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
        credentials:
          process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY,
                secretAccessKey: process.env.S3_SECRET_KEY,
              }
            : undefined,
      });
      this.store = new S3Store(client, bucket);
      this.kind = 's3';
    } else {
      if (messagingMode() === 'live')
        throw new Error('S3_BUCKET is required when SIMULATION_ENABLED=false');
      this.store = new MemoryStore();
      this.kind = 'memory';
    }
  }

  async onModuleInit() {
    if (this.store instanceof S3Store) await this.store.ensureBucket(this.log);
    else
      this.log.warn(
        'S3_BUCKET not set: simulation attachments are kept in memory only.',
      );
  }

  put(key: string, body: Buffer, contentType: string) {
    return this.store.put(key, body, contentType);
  }

  get(key: string) {
    return this.store.get(key);
  }
}

import dotenv from 'dotenv';
dotenv.config();
import { Storage } from '@google-cloud/storage';
import { TRPCError } from '@trpc/server';

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
});

export const bucket = storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME!);

// Short expiration time for signed URLs (5 minutes)
const SIGNED_URL_EXPIRATION = 5 * 60 * 1000;

// DEPRECATED: This function is no longer used - files are uploaded directly to GCS
// The backend proxy upload endpoint in index.ts handles direct uploads

/**
 * Gets a signed URL for a file
 * @param filePath The path of the file in the bucket
 * @returns The signed URL
 */
export async function getSignedUrl(filePath: string, action: 'read' | 'write' = 'read', contentType?: string): Promise<string> {
  try {
    const options: any = {
      version: 'v4',
      action: action,
      expires: Date.now() + SIGNED_URL_EXPIRATION,
    };

    // For write operations, add content type if provided
    if (action === 'write' && contentType) {
      options.contentType = contentType;
    }

    const [url] = await bucket.file(filePath).getSignedUrl(options);
    return url;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to get signed URL',
    });
  }
}

/**
 * Deletes a file from Google Cloud Storage
 * @param filePath The path of the file to delete
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await bucket.file(filePath).delete();
  } catch (error) {
    console.error('Error deleting file from Google Cloud Storage:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to delete file from storage',
    });
  }
}

/**
 * Checks if an object exists in Google Cloud Storage
 * @param bucketName The name of the bucket (unused, uses default bucket)
 * @param objectPath The path of the object to check
 * @returns Promise<boolean> True if the object exists, false otherwise
 */
export async function objectExists(bucketName: string, objectPath: string): Promise<boolean> {
  try {
    const [exists] = await bucket.file(objectPath).exists();
    return exists;
  } catch (error) {
    console.error('Error checking if object exists in Google Cloud Storage:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to check object existence',
    });
  }
} 
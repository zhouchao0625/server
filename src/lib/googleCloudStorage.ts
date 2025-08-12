import { Storage } from '@google-cloud/storage';
import { TRPCError } from '@trpc/server';

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
});

const bucket = storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME || '');

// Short expiration time for signed URLs (5 minutes)
const SIGNED_URL_EXPIRATION = 5 * 60 * 1000;

/**
 * Uploads a file to Google Cloud Storage
 * @param base64Data Base64 encoded file data
 * @param filePath The path where the file should be stored
 * @param contentType The MIME type of the file
 * @returns The path of the uploaded file
 */
export async function uploadFile(
  base64Data: string,
  filePath: string,
  contentType: string
): Promise<string> {
  try {
    // Remove the data URL prefix if present
    const base64Content = base64Data.includes('base64,')
      ? base64Data.split('base64,')[1]
      : base64Data;

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(base64Content, 'base64');

    // Create a new file in the bucket
    const file = bucket.file(filePath);

    // Upload the file
    await file.save(fileBuffer, {
      metadata: {
        contentType,
      },
    });

    return filePath;
  } catch (error) {
    console.error('Error uploading to Google Cloud Storage:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to upload file to storage',
    });
  }
}

/**
 * Gets a signed URL for a file
 * @param filePath The path of the file in the bucket
 * @returns The signed URL
 */
export async function getSignedUrl(filePath: string): Promise<string> {
  try {
    const [url] = await bucket.file(filePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_EXPIRATION,
    });
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
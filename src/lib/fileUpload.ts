import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import { uploadFile as uploadToGCS, getSignedUrl } from "./googleCloudStorage";
import { generateThumbnail, storeThumbnail, generateMediaThumbnail } from "./thumbnailGenerator";
import { prisma } from "./prisma";

export interface FileData {
  name: string;
  type: string;
  size: number;
  data: string; // base64 encoded file data
}

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  thumbnailId?: string;
}

/**
 * Uploads a single file to Google Cloud Storage and creates a file record
 * @param file The file data to upload
 * @param userId The ID of the user uploading the file
 * @param directory Optional directory to store the file in
 * @param assignmentId Optional assignment ID to associate the file with
 * @returns The uploaded file record
 */
export async function uploadFile(
  file: FileData,
  userId: string,
  directory?: string,
  assignmentId?: string
): Promise<UploadedFile> {
  try {
    // Create a unique filename
    const fileExtension = file.name.split('.').pop();
    const uniqueFilename = `${uuidv4()}.${fileExtension}`;
    
    // Construct the full path
    const filePath = directory 
      ? `${directory}/${uniqueFilename}`
      : uniqueFilename;
    
    // Upload to Google Cloud Storage
    const uploadedPath = await uploadToGCS(file.data, filePath, file.type);
    
    // Generate and store thumbnail if supported
    let thumbnailId: string | undefined;
    try {
      // Convert base64 to buffer for thumbnail generation
      const base64Data = file.data.split(',')[1];
      const fileBuffer = Buffer.from(base64Data, 'base64');
      
      // Generate thumbnail directly from buffer
      const thumbnailBuffer = await generateMediaThumbnail(fileBuffer, file.type);
      if (thumbnailBuffer) {
        // Store thumbnail in a thumbnails directory
        const thumbnailPath = `thumbnails/${filePath}`;
        const thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;
        await uploadToGCS(thumbnailBase64, thumbnailPath, 'image/jpeg');
        
        // Create thumbnail file record
        const thumbnailFile = await prisma.file.create({
          data: {
            name: `${file.name}_thumb.jpg`,
            type: 'image/jpeg',
            path: thumbnailPath,
            user: {
              connect: { id: userId }
            }
          }
        });
        
        thumbnailId = thumbnailFile.id;
      }
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }
    
    // Create file record in database
    const fileRecord = await prisma.file.create({
      data: {
        name: file.name,
        type: file.type,
        size: file.size,
        path: uploadedPath,
        user: {
          connect: { id: userId }
        },
        ...(thumbnailId && {
          thumbnail: {
            connect: { id: thumbnailId }
          }
        }),
        ...(assignmentId && {
          assignment: {
            connect: { id: assignmentId }
          }
        })
      },
    });
    
    // Return file information
    return {
      id: fileRecord.id,
      name: file.name,
      type: file.type,
      size: file.size,
      path: uploadedPath,
      thumbnailId: thumbnailId
    };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to upload file',
    });
  }
}

/**
 * Uploads multiple files
 * @param files Array of files to upload
 * @param userId The ID of the user uploading the files
 * @param directory Optional subdirectory to store the files in
 * @returns Array of uploaded file information
 */
export async function uploadFiles(
  files: FileData[], 
  userId: string,
  directory?: string
): Promise<UploadedFile[]> {
  try {
    const uploadPromises = files.map(file => uploadFile(file, userId, directory));
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('Error uploading files:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to upload files',
    });
  }
}

/**
 * Gets a signed URL for a file
 * @param filePath The path of the file in Google Cloud Storage
 * @returns The signed URL
 */
export async function getFileUrl(filePath: string): Promise<string> {
  try {
    return await getSignedUrl(filePath);
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to get file URL',
    });
  }
}
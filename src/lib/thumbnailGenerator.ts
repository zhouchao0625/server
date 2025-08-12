import sharp from 'sharp';
import { prisma } from './prisma';
import { uploadFile, deleteFile, getSignedUrl } from './googleCloudStorage';

// Thumbnail size configuration
const THUMBNAIL_WIDTH = 200;
const THUMBNAIL_HEIGHT = 200;

// File type configurations
const SUPPORTED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/bmp',
    'image/avif'
];

const DOCUMENT_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'text/plain',
    'text/csv',
    'application/json',
    'text/html',
    'text/javascript',
    'text/css'
];

const VIDEO_TYPES = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime'
];

const AUDIO_TYPES = [
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm'
];

/**
 * Generates a thumbnail for an image or PDF file
 * @param fileBuffer The file buffer
 * @param fileType The MIME type of the file
 * @returns Thumbnail buffer
 */
export async function generateMediaThumbnail(fileBuffer: Buffer, fileType: string): Promise<Buffer> {
    if (fileType === 'application/pdf') {
        // For PDFs, we need to use a different approach
        try {
            return await sharp(fileBuffer, { 
                density: 300, // Higher density for better quality
                page: 0 // First page only
            })
            .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({ quality: 80 })
            .toBuffer();
        } catch (error) {
            console.warn('Failed to generate PDF thumbnail:', error);
            return generateGenericThumbnail(fileType);
        }
    }
    
    // For regular images
    return sharp(fileBuffer)
        .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
            fit: 'inside',
            withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
}

/**
 * Generates a generic icon-based thumbnail for a file type
 * @param fileType The MIME type of the file
 * @returns Thumbnail buffer
 */
async function generateGenericThumbnail(fileType: string): Promise<Buffer> {
    // Create a blank canvas with a colored background based on file type
    const canvas = sharp({
        create: {
            width: THUMBNAIL_WIDTH,
            height: THUMBNAIL_HEIGHT,
            channels: 4,
            background: { r: 245, g: 245, b: 245, alpha: 1 }
        }
    });

    // Add a colored overlay based on file type
    let color = { r: 200, g: 200, b: 200, alpha: 0.5 }; // Default gray

    if (DOCUMENT_TYPES.includes(fileType)) {
        color = { r: 52, g: 152, b: 219, alpha: 0.5 }; // Blue for documents
    } else if (VIDEO_TYPES.includes(fileType)) {
        color = { r: 231, g: 76, b: 60, alpha: 0.5 }; // Red for videos
    } else if (AUDIO_TYPES.includes(fileType)) {
        color = { r: 46, g: 204, b: 113, alpha: 0.5 }; // Green for audio
    }

    return canvas
        .composite([{
            input: Buffer.from([color.r, color.g, color.b, Math.floor(color.alpha * 255)]),
            raw: {
                width: 1,
                height: 1,
                channels: 4
            },
            tile: true,
            blend: 'overlay'
        }])
        .jpeg({ quality: 80 })
        .toBuffer();
}

/**
 * Generates a thumbnail for a file
 * @param fileName The name of the file in Google Cloud Storage
 * @param fileType The MIME type of the file
 * @returns The thumbnail buffer or null if thumbnail generation is not supported
 */
export async function generateThumbnail(fileName: string, fileType: string): Promise<Buffer | null> {
    try {
        const signedUrl = await getSignedUrl(fileName);
        const response = await fetch(signedUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to download file from storage: ${response.status} ${response.statusText}`);
        }

        const fileBuffer = await response.arrayBuffer();

        if (SUPPORTED_IMAGE_TYPES.includes(fileType) || fileType === 'application/pdf') {
            try {
                const thumbnail = await generateMediaThumbnail(Buffer.from(fileBuffer), fileType);
                return thumbnail;
            } catch (error) {
                return generateGenericThumbnail(fileType);
            }
        } else if ([...DOCUMENT_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES].includes(fileType)) {
            return generateGenericThumbnail(fileType);
        }

        return null; // Unsupported file type
    } catch (error) {
        return null;
    }
}

/**
 * Stores a thumbnail in Google Cloud Storage and creates a File entry
 * @param thumbnailBuffer The thumbnail buffer to store
 * @param originalFileName The original file name
 * @param userId The user ID who owns the file
 * @returns The ID of the created thumbnail File
 */
export async function storeThumbnail(thumbnailBuffer: Buffer, originalFileName: string, userId: string): Promise<string> {
    // Convert buffer to base64 for uploadFile function
    const base64Data = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;
    const thumbnailFileName = await uploadFile(base64Data, `thumbnails/${originalFileName}_thumb`, 'image/jpeg');
    
    // Create a new File entry for the thumbnail
    const newThumbnail = await prisma.file.create({
        data: {
            name: `${originalFileName}_thumb.jpg`,
            path: thumbnailFileName,
            type: 'image/jpeg',
            userId: userId,
        },
    });
    
    return newThumbnail.id;
} 
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";
import { createDirectUploadFiles, type DirectUploadFile } from "../lib/fileUpload.js";
import { getSignedUrl } from "../lib/googleCloudStorage.js";
import { logger } from "../utils/logger.js";
import { bucket } from "../lib/googleCloudStorage.js";

// Helper function to convert file path to backend proxy URL
function getFileUrl(filePath: string | null): string | null {
  if (!filePath) return null;
  
  // If it's already a full URL (DiceBear or external), return as is
  if (filePath.startsWith('http')) {
    return filePath;
  }
  
  // Convert GCS path to full backend proxy URL
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  return `${backendUrl}/api/files/${encodeURIComponent(filePath)}`;
}

// For direct file uploads (file already uploaded to GCS)
const fileUploadSchema = z.object({
  filePath: z.string().min(1, "File path is required"),
  fileName: z.string().min(1, "File name is required"),
  fileType: z.string().regex(/^image\/(jpeg|jpg|png|gif|webp)$/i, "Only image files (JPEG, PNG, GIF, WebP) are allowed"),
  fileSize: z.number().max(5 * 1024 * 1024, "File size must be less than 5MB"),
});

// For DiceBear avatar URL
const dicebearSchema = z.object({
  url: z.string().url("Invalid DiceBear avatar URL"),
});

const profileSchema = z.object({
  displayName: z.string().nullable().optional().transform(val => val === null ? undefined : val),
  bio: z.string().nullable().optional().transform(val => val === null ? undefined : val),
  location: z.string().nullable().optional().transform(val => val === null ? undefined : val),
  website: z.union([
    z.string().url(),
    z.literal(""),
    z.null().transform(() => undefined)
  ]).optional(),
});

const updateProfileSchema = z.object({
  profile: profileSchema.optional(),
  // Support both custom file upload and DiceBear avatar
  profilePicture: fileUploadSchema.optional(),
  dicebearAvatar: dicebearSchema.optional(),
});

const getUploadUrlSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  fileType: z.string().regex(/^image\/(jpeg|jpg|png|gif|webp)$/i, "Only image files are allowed"),
});

export const userRouter = createTRPCRouter({
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          username: true,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Get user profile separately
      const userProfile = await prisma.userProfile.findUnique({
        where: { userId: ctx.user.id },
      });

      return {
        id: user.id,
        username: user.username,
        profile: userProfile ? {
          displayName: (userProfile as any).displayName || null,
          bio: (userProfile as any).bio || null,
          location: (userProfile as any).location || null,
          website: (userProfile as any).website || null,
          profilePicture: getFileUrl((userProfile as any).profilePicture),
          profilePictureThumbnail: getFileUrl((userProfile as any).profilePictureThumbnail),
        } : {
          displayName: null,
          bio: null,
          location: null,
          website: null,
          profilePicture: null,
          profilePictureThumbnail: null,
        },
      };
    }),

  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Get current profile to clean up old profile picture
      const currentProfile = await prisma.userProfile.findUnique({
        where: { userId: ctx.user.id },
      });

      let profilePictureUrl: string | null = null;
      let profilePictureThumbnail: string | null = null;

      // Handle custom profile picture (already uploaded to GCS)
      if (input.profilePicture) {
        try {
          // File is already uploaded to GCS, just use the path
          profilePictureUrl = input.profilePicture.filePath;
          
          // Generate thumbnail for the uploaded file
          // TODO: Implement thumbnail generation for direct uploads
          profilePictureThumbnail = null;

          // Clean up old profile picture if it exists
          if ((currentProfile as any)?.profilePicture) {
            // TODO: Implement file deletion logic here
            // await deleteFile((currentProfile as any).profilePicture);
          }
        } catch (error) {
          logger.error('Profile picture processing failed', { 
            userId: ctx.user.id, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to process profile picture. Please try again.",
          });
        }
      }

      // Handle DiceBear avatar URL
      if (input.dicebearAvatar) {
        profilePictureUrl = input.dicebearAvatar.url;
        // No thumbnail for DiceBear avatars since they're SVG URLs
        profilePictureThumbnail = null;
      }

      // Prepare update data
      const updateData: any = {};
      if (input.profile) {
        if (input.profile.displayName !== undefined && input.profile.displayName !== null) {
          updateData.displayName = input.profile.displayName;
        }
        if (input.profile.bio !== undefined && input.profile.bio !== null) {
          updateData.bio = input.profile.bio;
        }
        if (input.profile.location !== undefined && input.profile.location !== null) {
          updateData.location = input.profile.location;
        }
        if (input.profile.website !== undefined && input.profile.website !== null) {
          updateData.website = input.profile.website;
        }
      }
      if (profilePictureUrl !== null) updateData.profilePicture = profilePictureUrl;
      if (profilePictureThumbnail !== null) updateData.profilePictureThumbnail = profilePictureThumbnail;

      // Upsert user profile with structured data
      const updatedProfile = await prisma.userProfile.upsert({
        where: { userId: ctx.user.id },
        create: {
          userId: ctx.user.id,
          ...updateData,
        },
        update: {
          ...updateData,
          updatedAt: new Date(),
        },
      });

      // Get username for response
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { username: true },
      });

      return {
        id: ctx.user.id,
        username: user?.username || '',
        profile: {
          displayName: (updatedProfile as any).displayName || null,
          bio: (updatedProfile as any).bio || null,
          location: (updatedProfile as any).location || null,
          website: (updatedProfile as any).website || null,
          profilePicture: getFileUrl((updatedProfile as any).profilePicture),
          profilePictureThumbnail: getFileUrl((updatedProfile as any).profilePictureThumbnail),
        },
      };
    }),

  getUploadUrl: protectedProcedure
    .input(getUploadUrlSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      try {
        // Generate unique filename
        const fileExtension = input.fileName.split('.').pop();
        const uniqueFilename = `${ctx.user.id}-${Date.now()}.${fileExtension}`;
        const filePath = `users/${ctx.user.id}/profile/${uniqueFilename}`;

        // Generate backend proxy upload URL instead of direct GCS signed URL
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
        const uploadUrl = `${backendUrl}/api/upload/${encodeURIComponent(filePath)}`;

        logger.info('Generated upload URL', {
          userId: ctx.user.id,
          filePath,
          fileName: uniqueFilename,
          fileType: input.fileType,
          uploadUrl
        });

        return {
          uploadUrl,
          filePath,
          fileName: uniqueFilename,
        };
      } catch (error) {
        logger.error('Failed to generate upload URL', { 
          userId: ctx.user.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate upload URL",
        });
      }
    }),
}); 
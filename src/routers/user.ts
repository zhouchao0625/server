import { TRPCError } from "@trpc/server";
import redis from "src/lib/redis";
import { z } from "zod";
import { uploadFiles, type UploadedFile } from "../lib/fileUpload";
import { prisma } from "../lib/prisma";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const fileSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number(),
  data: z.string(), // base64 encoded file data
});

const updateProfileSchema = z.object({
  profile: z.record(z.any()),
  profilePicture: fileSchema.optional(),
});

export const userRouter = createTRPCRouter({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User must be authenticated",
      });
    }

    const cacheKey = `user:${ctx.user.id}`;

    // Try getting data from Redis
    const cached = await redis.get(cacheKey);
    console.log("class Cache hit:", cached);
    if (cached) {
      return JSON.parse(cached);
    }

    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        username: true,
        profile: true,
      },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    // Store in Redis (set cache for 10 mins)
    await redis.set(cacheKey, JSON.stringify(user), {
      EX: 600, // 600 seconds = 10 minutes
    });

    return user;
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

      let uploadedFiles: UploadedFile[] = [];
      if (input.profilePicture) {
        // Store profile picture in a user-specific directory
        uploadedFiles = await uploadFiles(
          [input.profilePicture],
          ctx.user.id,
          `users/${ctx.user.id}/profile`
        );

        // Add profile picture path to profile data
        input.profile.profilePicture = uploadedFiles[0].path;
        input.profile.profilePictureThumbnail = uploadedFiles[0].thumbnailId;
      }

      const updatedUser = await prisma.user.update({
        where: { id: ctx.user.id },
        data: {
          profile: input.profile,
        },
        select: {
          id: true,
          username: true,
          profile: true,
        },
      });

      const cacheKey = `user:${ctx.user.id}`;
      await redis.del(cacheKey);

      return updatedUser;
    }),
});

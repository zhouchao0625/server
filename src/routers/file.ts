import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { getSignedUrl } from "../lib/googleCloudStorage";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const fileRouter = createTRPCRouter({
  getSignedUrl: protectedProcedure
    .input(z.object({
      fileId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { fileId } = input;
      const userId = ctx.user?.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to access files",
        });
      }

      // Get file metadata from database
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: {
          assignment: {
            include: {
              class: {
                include: {
                  students: true,
                  teachers: true
                }
              }
            }
          },
          submission: {
            include: {
              student: true,
              assignment: {
                include: {
                  class: {
                    include: {
                      teachers: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File does not exist",
        });
      }

      // Check if user has access to the file
      const hasAccess = 
        // File owner
        file.userId === userId ||
        // Assignment file - student in class or teacher
        (file.assignment && (
          file.assignment.class.students.some((s: User) => s.id === userId) ||
          file.assignment.class.teachers.some((t: User) => t.id === userId)
        )) ||
        // Submission file - student who submitted or teacher of class
        (file.submission && (
          file.submission.student.id === userId ||
          file.submission.assignment.class.teachers.some((t: User) => t.id === userId)
        ));

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this file",
        });
      }

      try {
        // Generate a signed URL with short expiration
        const signedUrl = await getSignedUrl(file.path);
        return { signedUrl };
      } catch (error) {
        console.error('Error generating signed URL:', error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate signed URL",
        });
      }
    }),
}); 
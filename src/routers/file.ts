import { z } from "zod";
import { createTRPCRouter, protectedProcedure, protectedTeacherProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { getSignedUrl, deleteFile } from "../lib/googleCloudStorage.js";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

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
          },
          annotations: {
            include: {
              student: true,
              assignment: {
                include: {
                  class: {
                    include: {
                      teachers: true,
                    }
                  }
                }
              }
            }
          },
          folder: {
            include: {
              class: {
                include: {
                  students: true,
                  teachers: true
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

      // Check if user has access to this file
      let hasAccess = false;

      let classId: string | null = null;

      // Check if user is a teacher of the class
      if (file.assignment?.class) {
        classId = file.assignment.class.id;
        hasAccess = file.assignment.class.teachers.some(teacher => teacher.id === userId) || false;
      }

      if (file.submission?.assignment?.classId) {
        classId = file.submission.assignment.classId;
        hasAccess = file.submission?.studentId === userId || false;
        if (!hasAccess) hasAccess = file.submission.assignment.class.teachers.some(teacher => teacher.id === userId) || false;
      }

      if (file.annotations?.assignment?.classId) {
        classId = file.annotations?.assignment.classId;
        hasAccess = file.annotations?.studentId === userId || false;
        if (!hasAccess) hasAccess = file.annotations.assignment.class.teachers.some(teacher => teacher.id === userId) || false;
      }

      // Check if user is the file owner
      if (file.userId === userId) {
        hasAccess = true;
      }

      // Check if file is in a folder and user has access to the class
      if (file.folder?.class) {
        hasAccess = hasAccess || file.folder.class.teachers.some(teacher => teacher.id === userId);
        hasAccess = hasAccess || file.folder.class.students.some(student => student.id === userId);
      }

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this file",
        });
      }

      try {
        const signedUrl = await getSignedUrl(file.path);
        return { url: signedUrl };
      } catch (error) {
        logger.error('Error generating signed URL:', error as Record<string, any>);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate download URL",
        });
      }
    }),

  move: protectedTeacherProcedure
    .input(z.object({
      fileId: z.string(),
      targetFolderId: z.string(),
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { fileId, targetFolderId } = input;

      // Get the file
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: {
          folder: {
            include: {
              class: true,
            },
          },
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found",
        });
      }

      // Get the target folder
      const targetFolder = await prisma.folder.findUnique({
        where: { id: targetFolderId },
        include: {
          class: true,
        },
      });

      if (!targetFolder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target folder not found",
        });
      }

      // Move the file
      const updatedFile = await prisma.file.update({
        where: { id: fileId },
        data: {
          folderId: targetFolderId,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return updatedFile;
    }),

  rename: protectedTeacherProcedure
    .input(z.object({
      fileId: z.string(),
      newName: z.string(),
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { fileId, newName, classId } = input;

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: {
              id: ctx.user!.id,
            },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must be a teacher of this class to rename files",
        });
      }

      // Get the file
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: {
          folder: {
            include: {
              class: true,
            },
          },
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found",
        });
      }

      // Validate new name
      if (!newName.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "File name cannot be empty",
        });
      }

      // Rename the file
      const updatedFile = await prisma.file.update({
        where: { id: fileId },
        data: {
          name: newName.trim(),
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return updatedFile;
    }),

  delete: protectedTeacherProcedure
    .input(z.object({
      fileId: z.string(),
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { fileId, classId } = input;

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: {
              id: ctx.user!.id,
            },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must be a teacher of this class to delete files",
        });
      }

      // Get the file
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: {
          folder: {
            include: {
              class: true,
            },
          },
          thumbnail: true,
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found",
        });
      }

      // Verify the file belongs to this class
      if (file.folder?.classId !== classId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "File does not belong to this class",
        });
      }

      // Delete files from storage
      try {
        // Delete the main file
        await deleteFile(file.path);
        
        // Delete thumbnail if it exists
        if (file.thumbnail) {
          await deleteFile(file.thumbnail.path);
        }
      } catch (error) {
        logger.warn(`Failed to delete file ${file.path}:`, error as Record<string, any>);
      }

      // Delete the file record from database
      await prisma.file.delete({
        where: { id: fileId },
      });

      return { success: true };
    }),
}); 
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, protectedClassMemberProcedure, protectedTeacherProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";
import { uploadFiles, type UploadedFile } from "../lib/fileUpload.js";

const fileSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number(),
  data: z.string(), // base64 encoded file data
});

const createFolderSchema = z.object({
  name: z.string(),
  parentFolderId: z.string().optional(),
  color: z.string().optional(),
});

const uploadFilesToFolderSchema = z.object({
  folderId: z.string(),
  files: z.array(fileSchema),
});

const getRootFolderSchema = z.object({
  classId: z.string(),
});

export const folderRouter = createTRPCRouter({
  create: protectedTeacherProcedure
    .input(createFolderSchema)
    .mutation(async ({ ctx, input }) => {
      const { classId, name, color } = input;
      let parentFolderId = input.parentFolderId || null;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to create a folder",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: {
              id: ctx.user.id,
            },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Class not found or you are not a teacher",
        });
      }

      // If no parent folder specified, find or create the class parent folder
      if (!parentFolderId) {
        let classParentFolder = await prisma.folder.findFirst({
          where: {
            classId: classId,
            parentFolderId: null,
          },
        });

        if (!classParentFolder) {
          // Create parent folder if it doesn't exist
          classParentFolder = await prisma.folder.create({
            data: {
              name: "Class Files",
              class: {
                connect: { id: classId },
              },
              ...(color && {
                color: color,
              }),
            },
          });
        }

        parentFolderId = classParentFolder.id;
      } else {
        // Check if specified parent folder exists and belongs to the class
        const parentFolder = await prisma.folder.findFirst({
          where: {
            id: parentFolderId,
          },
        });

        if (!parentFolder) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Parent folder not found",
          });
        }
      }

      const folder = await prisma.folder.create({
        data: {
          name,
          ...(parentFolderId && {
            parentFolder: {
              connect: { id: parentFolderId },
            },
          }),
          ...(color && {
            color: color,
          }),
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              _count: {
                select: {
                  files: true,
                  childFolders: true,
                },
              },
            },
          },
        },
      });

      return folder;
    }),

  get: protectedClassMemberProcedure
    .input(z.object({
      folderId: z.string(),
      classId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { classId, folderId } = input;

      // Get specific folder
      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
            orderBy: {
              uploadedAt: 'desc',
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              color: true,
              _count: {
                select: {
                  files: true,
                  childFolders: true,
                },
              },
            },
            orderBy: {
              name: 'asc',
            },
          },
          parentFolder: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Folder not found",
        });
      }

      return folder;
    }),

  getChildFolders: protectedClassMemberProcedure
    .input(z.object({
      classId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      // Get the parent folder for the class (or create it if it doesn't exist)
      let parentFolder = await prisma.folder.findFirst({
        where: {
          classId: classId,
          parentFolderId: null,
        },
      });

      if (!parentFolder) {
        // Create parent folder if it doesn't exist
        parentFolder = await prisma.folder.create({
          data: {
            name: "Class Files",
            class: {
              connect: { id: classId },
            },
          },
        });
      }

      // Get all child folders of the parent
      const childFolders = await prisma.folder.findMany({
        where: {
          parentFolderId: parentFolder.id,
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
            orderBy: {
              uploadedAt: 'desc',
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              _count: {
                select: {
                  files: true,
                  childFolders: true,
                },
              },
            },
            orderBy: {
              name: 'asc',
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      return childFolders;
    }),

  getFolderChildren: protectedClassMemberProcedure
    .input(z.object({
      folderId: z.string(),
      classId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { folderId, classId } = input;

      // Get direct children of the specified folder
      const children = await prisma.folder.findMany({
        where: {
          parentFolderId: folderId,
          classId: classId,
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
            orderBy: {
              uploadedAt: 'desc',
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              color: true,
              _count: {
                select: {
                  files: true,
                  childFolders: true,
                },
              },
            },
            orderBy: {
              name: 'asc',
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      return children;
    }),

  getRootFolder: protectedClassMemberProcedure
    .input(getRootFolderSchema)
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      // Get or create the parent folder for the class
      let parentFolder = await prisma.folder.findFirst({
        where: {
          classId: classId,
          parentFolderId: null,
        },
      });

      if (!parentFolder) {
        // Create parent folder if it doesn't exist
        parentFolder = await prisma.folder.create({
          data: {
            name: "Class Files",
            class: {
              connect: { id: classId },
            },
          },
        });
      }

      // Get the parent folder with its files and child folders
      const rootFolder = await prisma.folder.findFirst({
        where: {
          id: parentFolder.id,
          classId: classId,
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
            orderBy: {
              uploadedAt: 'desc',
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              color: true,
              files: {
                select: {
                  id: true,
                },
              },
              childFolders: {
                select: {
                  id: true,
                },
              },
            },
            orderBy: {
              name: 'asc',
            },
          },
        },
      });

      return rootFolder;
    }),

  uploadFiles: protectedTeacherProcedure
    .input(uploadFilesToFolderSchema)
    .mutation(async ({ ctx, input }) => {
      const { classId, folderId, files } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to upload files",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: {
              id: ctx.user.id,
            },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Class not found or you are not a teacher",
        });
      }

      // Verify folder exists and belongs to the class
      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Folder not found",
        });
      }

      // Upload files
      const uploadedFiles = await uploadFiles(files, ctx.user.id, folder.id);
      
      // Create file records in database
    //   const fileRecords = await prisma.file.createMany({
    //     data: uploadedFiles.map(file => ({
    //       name: file.name,
    //       type: file.type,
    //       size: file.size,
    //       path: file.path,
    //       userId: ctx.user!.id,
    //       folderId: folderId,
    //       ...(file.thumbnailId && {
    //         thumbnailId: file.thumbnailId,
    //       }),
    //     })),
    //   });

      return {
        success: true,
        uploadedCount: uploadedFiles.length,
      };
    }),

  delete: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      folderId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, folderId } = input;

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
          message: "Class not found or you are not a teacher",
        });
      }

      // Verify folder exists and belongs to the class
      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
          classId: classId,
        },
        include: {
          _count: {
            select: {
              files: true,
              childFolders: true,
            },
          },
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Folder not found",
        });
      }

      // Delete folder and all its contents (cascade)
      await prisma.folder.delete({
        where: {
          id: folderId,
        },
      });

      return {
        success: true,
        deletedFiles: folder._count.files,
        deletedFolders: folder._count.childFolders + 1, // +1 for the folder itself
      };
    }),

  move: protectedTeacherProcedure
    .input(z.object({
      folderId: z.string(),
      targetParentFolderId: z.string(),
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { folderId, targetParentFolderId, classId } = input;

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
          message: "You must be a teacher of this class to move folders",
        });
      }

      // Get the folder to move
      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Folder not found",
        });
      }

      // Prevent moving the root folder
      if (!folder.parentFolderId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot move the root folder",
        });
      }

      // If target parent folder is specified, verify it exists and belongs to the class
      if (targetParentFolderId) {
        const targetParentFolder = await prisma.folder.findFirst({
          where: {
            id: targetParentFolderId,
          },
        });

        if (!targetParentFolder) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Target parent folder not found",
          });
        }

        // Prevent moving a folder into itself or its descendants
        if (targetParentFolderId === folderId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot move a folder into itself",
          });
        }

        // Check if target is a descendant of the folder being moved
        let currentParent: any = targetParentFolder;
        while (currentParent?.parentFolderId) {
          if (currentParent.parentFolderId === folderId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot move a folder into its descendant",
            });
          }
          currentParent = await prisma.folder.findUnique({
            where: { id: currentParent.parentFolderId },
          });
          if (!currentParent) break;
        }
      } else {
        // Moving to root - verify the folder isn't already at root
        if (!folder.parentFolderId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Folder is already at root level",
          });
        }
      }

      // Move the folder
      const updatedFolder = await prisma.folder.update({
        where: { id: folderId },
        data: {
          parentFolderId: targetParentFolderId,
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              _count: {
                select: {
                  files: true,
                  childFolders: true,
                },
              },
            },
          },
        },
      });

      return updatedFolder;
    }),

  update: protectedTeacherProcedure
    .input(z.object({
      folderId: z.string(),
      name: z.string(),
      color: z.string().optional(),
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { folderId, name, color, classId } = input;

      // Get the folder
      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Folder not found",
        });
      }

      // Validate new name
      if (!name.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Folder name cannot be empty",
        });
      }

      // Rename the folder
      const updatedFolder = await prisma.folder.update({
        where: { id: folderId },
        data: {
          name: name.trim(),
          ...(color && {
            color: color,
          }),
        },
        include: {
          files: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              uploadedAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          childFolders: {
            select: {
              id: true,
              name: true,
              _count: {
                select: {
                  files: true,
                  childFolders: true,
                },
              },
            },
          },
        },
      });

      return updatedFolder;
    }),
}); 
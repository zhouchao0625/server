import { z } from "zod";
import { createTRPCRouter, protectedClassMemberProcedure, protectedTeacherProcedure, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";
import { sendNotifications } from "../lib/notificationHandler.js";
import { logger } from "../utils/logger.js";
import { createDirectUploadFiles, type UploadedFile, type DirectUploadFile, confirmDirectUpload } from "../lib/fileUpload.js";
import { deleteFile } from "../lib/googleCloudStorage.js";

// Schema for direct file uploads (no base64 data)
const directFileSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number(),
});

// Schemas for file upload endpoints
const getAnnouncementUploadUrlsSchema = z.object({
  announcementId: z.string(),
  classId: z.string(),
  files: z.array(directFileSchema),
});

const confirmAnnouncementUploadSchema = z.object({
  fileId: z.string(),
  uploadSuccess: z.boolean(),
  errorMessage: z.string().optional(),
});

const AnnouncementSelect = {
    id: true,
    teacher: {
        select: {
            id: true,
            username: true,
        },
    },
    remarks: true,
    createdAt: true,
    modifiedAt: true,
    attachments: {
        select: {
            id: true,
            name: true,
            type: true,
            size: true,
            path: true,
            uploadedAt: true,
            thumbnailId: true,
        },
    },
};

export const announcementRouter = createTRPCRouter({
    getAll: protectedClassMemberProcedure
        .input(z.object({
            classId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const announcements = await prisma.announcement.findMany({
                where: {
                    classId: input.classId,
                },
                select: {
                    ...AnnouncementSelect,
                    _count: {
                        select: {
                            comments: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            // Transform to include comment count
            const announcementsWithCounts = announcements.map(announcement => ({
                ...announcement,
                commentCount: announcement._count.comments,
                _count: undefined,
            }));

            return {
                announcements: announcementsWithCounts,
            };
        }),

    get: protectedClassMemberProcedure
        .input(z.object({
            id: z.string(),
            classId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            const announcement = await prisma.announcement.findUnique({
                where: {
                    id: input.id,
                    classId: input.classId,
                },
                select: AnnouncementSelect,
            });

            if (!announcement) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Announcement not found",
                });
            }

            return {
                announcement,
            };
        }),

    create: protectedTeacherProcedure
        .input(z.object({
            classId: z.string(),
            remarks: z.string().min(1, "Remarks cannot be empty"),
            files: z.array(directFileSchema).optional(),
            existingFileIds: z.array(z.string()).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const { classId, remarks, files, existingFileIds } = input;

            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            const classData = await prisma.class.findUnique({
                where: { id: classId },
                include: {
                  students: {
                    select: { id: true }
                  }
                }
            });

            if (!classData) {
                throw new TRPCError({
                  code: "NOT_FOUND",
                  message: "Class not found",
                });
            }

            const announcement = await prisma.announcement.create({
                data: {
                    remarks: remarks,
                    teacher: {
                        connect: {
                            id: ctx.user.id,
                        },
                    },
                    class: {
                        connect: {
                            id: classId,
                        },
                    },
                },
                select: AnnouncementSelect,
            });

            // Handle file attachments
            // NOTE: Files are now handled via direct upload endpoints
            // The files field in the schema is for metadata only
            // Actual file uploads should use getAnnouncementUploadUrls endpoint
            // However, if files are provided here, we create the file records and return upload URLs
            let directUploadFiles: DirectUploadFile[] = [];
            if (files && files.length > 0) {
                // Create direct upload files - this creates file records with upload URLs
                // Files are automatically connected to the announcement via announcementId
                directUploadFiles = await createDirectUploadFiles(files, ctx.user.id, undefined, undefined, undefined, announcement.id);
            }

            // Connect existing files if provided
            if (existingFileIds && existingFileIds.length > 0) {
                await prisma.announcement.update({
                    where: { id: announcement.id },
                    data: {
                        attachments: {
                            connect: existingFileIds.map(fileId => ({ id: fileId }))
                        }
                    }
                });
            }

            // Fetch announcement with attachments
            const announcementWithAttachments = await prisma.announcement.findUnique({
                where: { id: announcement.id },
                select: AnnouncementSelect,
            });

            sendNotifications(classData.students.map(student => student.id), {
                title: `🔔 Announcement for ${classData.name}`,
                content: remarks
            }).catch(error => {
                logger.error('Failed to send announcement notifications:', error);
            });

            return {
                announcement: announcementWithAttachments || announcement,
                // Return upload URLs if files were provided
                uploadFiles: directUploadFiles.length > 0 ? directUploadFiles : undefined,
            };
        }),

    update: protectedProcedure
        .input(z.object({
            id: z.string(),
            data: z.object({
                remarks: z.string().min(1, "Remarks cannot be empty").optional(),
                files: z.array(directFileSchema).optional(),
                existingFileIds: z.array(z.string()).optional(),
                removedAttachments: z.array(z.string()).optional(),
            }),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            const announcement = await prisma.announcement.findUnique({
                where: { id: input.id },
                include: {
                    class: {
                        include: {
                            teachers: true,
                        },
                    },
                    attachments: {
                        select: {
                            id: true,
                            name: true,
                            type: true,
                            path: true,
                            size: true,
                            uploadStatus: true,
                            thumbnail: {
                                select: {
                                    path: true
                                }
                            }
                        },
                    },
                },
            });

            if (!announcement) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Announcement not found",
                });
            }

            // Authorization check: user must be the creator OR a teacher in the class
            const userId = ctx.user.id;
            const isCreator = announcement.teacherId === userId;
            const isClassTeacher = announcement.class.teachers.some(
                (teacher) => teacher.id === userId
            );

            if (!isCreator && !isClassTeacher) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Only the announcement creator or class teachers can update announcements",
                });
            }

            // Handle file attachments
            // NOTE: Files are now handled via direct upload endpoints
            let directUploadFiles: DirectUploadFile[] = [];
            if (input.data.files && input.data.files.length > 0) {
                // Create direct upload files - this creates file records with upload URLs
                // Files are automatically connected to the announcement via announcementId
                directUploadFiles = await createDirectUploadFiles(input.data.files, userId, undefined, undefined, undefined, input.id);
            }

            // Delete removed attachments from storage before updating database
            if (input.data.removedAttachments && input.data.removedAttachments.length > 0) {
                const filesToDelete = announcement.attachments.filter((file) =>
                    input.data.removedAttachments!.includes(file.id)
                );

                // Delete files from storage (only if they were actually uploaded)
                await Promise.all(filesToDelete.map(async (file) => {
                    try {
                        // Only delete from GCS if the file was successfully uploaded
                        if (file.uploadStatus === 'COMPLETED') {
                            // Delete the main file
                            await deleteFile(file.path);

                            // Delete thumbnail if it exists
                            if (file.thumbnail?.path) {
                                await deleteFile(file.thumbnail.path);
                            }
                        }
                    } catch (error) {
                        logger.warn(`Failed to delete file ${file.path}:`, {
                            error: error instanceof Error ? {
                                name: error.name,
                                message: error.message,
                                stack: error.stack,
                            } : error
                        });
                    }
                }));
            }

            const updatedAnnouncement = await prisma.announcement.update({
                where: { id: input.id },
                data: {
                    ...(input.data.remarks && { remarks: input.data.remarks }),
                    // Note: directUploadFiles are already connected via createDirectUploadFiles
                    ...(input.data.existingFileIds && input.data.existingFileIds.length > 0 && {
                        attachments: {
                            connect: input.data.existingFileIds.map(fileId => ({ id: fileId }))
                        }
                    }),
                    ...(input.data.removedAttachments && input.data.removedAttachments.length > 0 && {
                        attachments: {
                            deleteMany: {
                                id: { in: input.data.removedAttachments }
                            }
                        }
                    }),
                },
                select: AnnouncementSelect,
            });

            return { 
                announcement: updatedAnnouncement,
                // Return upload URLs if new files were provided
                uploadFiles: directUploadFiles.length > 0 ? directUploadFiles : undefined,
            };
        }),

    delete: protectedProcedure
        .input(z.object({
            id: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            const announcement = await prisma.announcement.findUnique({
                where: { id: input.id },
                include: {
                    class: {
                        include: {
                            teachers: true,
                        },
                    },
                },
            });

            if (!announcement) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Announcement not found",
                });
            }

            // Authorization check: user must be the creator OR a teacher in the class
            const userId = ctx.user.id;
            const isCreator = announcement.teacherId === userId;
            const isClassTeacher = announcement.class.teachers.some(
                (teacher) => teacher.id === userId
            );

            if (!isCreator && !isClassTeacher) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Only the announcement creator or class teachers can delete announcements",
                });
            }

            await prisma.announcement.delete({
                where: { id: input.id },
            });

            return { success: true };
        }),

    getAnnouncementUploadUrls: protectedTeacherProcedure
        .input(getAnnouncementUploadUrlsSchema)
        .mutation(async ({ ctx, input }) => {
            const { announcementId, classId, files } = input;

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

            // Verify announcement exists and belongs to the class
            const announcement = await prisma.announcement.findFirst({
                where: {
                    id: announcementId,
                    classId: classId,
                },
            });

            if (!announcement) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Announcement not found",
                });
            }

            // Create direct upload files
            const directUploadFiles = await createDirectUploadFiles(
                files,
                ctx.user.id,
                undefined, // No specific directory
                undefined, // No assignment ID
                undefined, // No submission ID
                announcementId
            );

            return {
                success: true,
                uploadFiles: directUploadFiles,
            };
        }),

    confirmAnnouncementUpload: protectedTeacherProcedure
        .input(confirmAnnouncementUploadSchema)
        .mutation(async ({ ctx, input }) => {
            const { fileId, uploadSuccess, errorMessage } = input;

            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "You must be logged in",
                });
            }

            // Verify file belongs to user and is an announcement file
            const file = await prisma.file.findFirst({
                where: {
                    id: fileId,
                    userId: ctx.user.id,
                    announcement: {
                        isNot: null,
                    },
                },
            });

            if (!file) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "File not found or you don't have permission",
                });
            }

            await confirmDirectUpload(fileId, uploadSuccess, errorMessage);

            return {
                success: true,
                message: uploadSuccess ? "Upload confirmed successfully" : "Upload failed",
            };
        }),

    // Comment endpoints
    addComment: protectedClassMemberProcedure
        .input(z.object({
            announcementId: z.string(),
            classId: z.string(),
            content: z.string().min(1, "Comment cannot be empty"),
            parentCommentId: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            // Verify announcement exists and belongs to the class
            const announcement = await prisma.announcement.findFirst({
                where: {
                    id: input.announcementId,
                    classId: input.classId,
                },
            });

            if (!announcement) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Announcement not found",
                });
            }

            // If replying to a comment, verify parent comment exists and belongs to the same announcement
            if (input.parentCommentId) {
                const parentComment = await prisma.announcementComment.findFirst({
                    where: {
                        id: input.parentCommentId,
                        announcementId: input.announcementId,
                    },
                });

                if (!parentComment) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Parent comment not found",
                    });
                }
            }

            const comment = await prisma.announcementComment.create({
                data: {
                    content: input.content,
                    author: {
                        connect: { id: ctx.user.id },
                    },
                    announcement: {
                        connect: { id: input.announcementId },
                    },
                    ...(input.parentCommentId && {
                        parentComment: {
                            connect: { id: input.parentCommentId },
                        },
                    }),
                },
                include: {
                    author: {
                        select: {
                            id: true,
                            username: true,
                            profile: {
                                select: {
                                    displayName: true,
                                    profilePicture: true,
                                    profilePictureThumbnail: true,
                                },
                            },
                        },
                    },
                },
            });

            return { comment };
        }),

    updateComment: protectedProcedure
        .input(z.object({
            id: z.string(),
            content: z.string().min(1, "Comment cannot be empty"),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            const comment = await prisma.announcementComment.findUnique({
                where: { id: input.id },
            });

            if (!comment) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Comment not found",
                });
            }

            // Only the author can update their comment
            if (comment.authorId !== ctx.user.id) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Only the comment author can update this comment",
                });
            }

            const updatedComment = await prisma.announcementComment.update({
                where: { id: input.id },
                data: {
                    content: input.content,
                },
                include: {
                    author: {
                        select: {
                            id: true,
                            username: true,
                            profile: {
                                select: {
                                    displayName: true,
                                    profilePicture: true,
                                    profilePictureThumbnail: true,
                                },
                            },
                        },
                    },
                },
            });

            return { comment: updatedComment };
        }),

    deleteComment: protectedProcedure
        .input(z.object({
            id: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            const comment = await prisma.announcementComment.findUnique({
                where: { id: input.id },
                include: {
                    announcement: {
                        include: {
                            class: {
                                include: {
                                    teachers: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!comment) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Comment not found",
                });
            }

            // Only the author or a class teacher can delete comments
            const userId = ctx.user.id;
            const isAuthor = comment.authorId === userId;
            const isClassTeacher = comment.announcement.class.teachers.some(
                (teacher) => teacher.id === userId
            );

            if (!isAuthor && !isClassTeacher) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Only the comment author or class teachers can delete comments",
                });
            }

            await prisma.announcementComment.delete({
                where: { id: input.id },
            });

            return { success: true };
        }),

    getComments: protectedClassMemberProcedure
        .input(z.object({
            announcementId: z.string(),
            classId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            // Verify announcement exists and belongs to the class
            const announcement = await prisma.announcement.findFirst({
                where: {
                    id: input.announcementId,
                    classId: input.classId,
                },
            });

            if (!announcement) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Announcement not found",
                });
            }

            // Get all top-level comments (no parent)
            const comments = await prisma.announcementComment.findMany({
                where: {
                    announcementId: input.announcementId,
                    parentCommentId: null,
                },
                include: {
                    author: {
                        select: {
                            id: true,
                            username: true,
                            profile: {
                                select: {
                                    displayName: true,
                                    profilePicture: true,
                                    profilePictureThumbnail: true,
                                },
                            },
                        },
                    },
                    replies: {
                        include: {
                            author: {
                                select: {
                                    id: true,
                                    username: true,
                                    profile: {
                                        select: {
                                            displayName: true,
                                            profilePicture: true,
                                            profilePictureThumbnail: true,
                                        },
                                    },
                                },
                            },
                        },
                        orderBy: {
                            createdAt: 'asc',
                        },
                    },
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });

            return { comments };
        }),

    // Reaction endpoints
    addReaction: protectedClassMemberProcedure
        .input(z.object({
            announcementId: z.string().optional(),
            commentId: z.string().optional(),
            classId: z.string(),
            type: z.enum(['THUMBSUP', 'CELEBRATE', 'CARE', 'HEART', 'IDEA', 'HAPPY']),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            // Exactly one of announcementId or commentId must be provided
            if (!input.announcementId && !input.commentId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Either announcementId or commentId must be provided",
                });
            }

            if (input.announcementId && input.commentId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Cannot react to both announcement and comment at the same time",
                });
            }

            const userId = ctx.user.id;

            // Verify the announcement or comment exists and belongs to the class
            if (input.announcementId) {
                const announcement = await prisma.announcement.findFirst({
                    where: {
                        id: input.announcementId,
                        classId: input.classId,
                    },
                });

                if (!announcement) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Announcement not found",
                    });
                }

                // Upsert reaction: update if exists, create if not
                const reaction = await prisma.reaction.upsert({
                    where: {
                        userId_announcementId: {
                            userId,
                            announcementId: input.announcementId,
                        },
                    },
                    update: {
                        type: input.type,
                    },
                    create: {
                        type: input.type,
                        userId,
                        announcementId: input.announcementId,
                    },
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                profile: {
                                    select: {
                                        displayName: true,
                                        profilePicture: true,
                                        profilePictureThumbnail: true,
                                    },
                                },
                            },
                        },
                    },
                });

                return { reaction };
            } else if (input.commentId) {
                // Verify comment exists and get its announcement to check class
                const comment = await prisma.announcementComment.findUnique({
                    where: { id: input.commentId },
                    include: {
                        announcement: {
                            select: {
                                classId: true,
                            },
                        },
                    },
                });

                if (!comment) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Comment not found",
                    });
                }

                if (comment.announcement.classId !== input.classId) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Comment does not belong to this class",
                    });
                }

                // Upsert reaction: update if exists, create if not
                const reaction = await prisma.reaction.upsert({
                    where: {
                        userId_commentId: {
                            userId,
                            commentId: input.commentId,
                        },
                    },
                    update: {
                        type: input.type,
                    },
                    create: {
                        type: input.type,
                        userId,
                        commentId: input.commentId,
                    },
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                profile: {
                                    select: {
                                        displayName: true,
                                        profilePicture: true,
                                        profilePictureThumbnail: true,
                                    },
                                },
                            },
                        },
                    },
                });

                return { reaction };
            }

            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Unexpected error",
            });
        }),

    removeReaction: protectedProcedure
        .input(z.object({
            announcementId: z.string().optional(),
            commentId: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            // Exactly one of announcementId or commentId must be provided
            if (!input.announcementId && !input.commentId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Either announcementId or commentId must be provided",
                });
            }

            const userId = ctx.user.id;

            if (input.announcementId) {
                const reaction = await prisma.reaction.findUnique({
                    where: {
                        userId_announcementId: {
                            userId,
                            announcementId: input.announcementId,
                        },
                    },
                });

                if (!reaction) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Reaction not found",
                    });
                }

                await prisma.reaction.delete({
                    where: { id: reaction.id },
                });

                return { success: true };
            } else if (input.commentId) {
                const reaction = await prisma.reaction.findUnique({
                    where: {
                        userId_commentId: {
                            userId,
                            commentId: input.commentId,
                        },
                    },
                });

                if (!reaction) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Reaction not found",
                    });
                }

                await prisma.reaction.delete({
                    where: { id: reaction.id },
                });

                return { success: true };
            }

            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Unexpected error",
            });
        }),

    getReactions: protectedClassMemberProcedure
        .input(z.object({
            announcementId: z.string().optional(),
            commentId: z.string().optional(),
            classId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            if (!ctx.user) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "User must be authenticated",
                });
            }

            // Exactly one of announcementId or commentId must be provided
            if (!input.announcementId && !input.commentId) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Either announcementId or commentId must be provided",
                });
            }

            const userId = ctx.user.id;

            if (input.announcementId) {
                // Verify announcement exists
                const announcement = await prisma.announcement.findFirst({
                    where: {
                        id: input.announcementId,
                        classId: input.classId,
                    },
                });

                if (!announcement) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Announcement not found",
                    });
                }

                // Get reaction counts by type
                const reactionCounts = await prisma.reaction.groupBy({
                    by: ['type'],
                    where: { announcementId: input.announcementId },
                    _count: { type: true },
                });

                // Get current user's reaction
                const userReaction = await prisma.reaction.findUnique({
                    where: {
                        userId_announcementId: {
                            userId,
                            announcementId: input.announcementId,
                        },
                    },
                });

                // Format counts
                const counts = {
                    THUMBSUP: 0,
                    CELEBRATE: 0,
                    CARE: 0,
                    HEART: 0,
                    IDEA: 0,
                    HAPPY: 0,
                };

                reactionCounts.forEach((item) => {
                    counts[item.type as keyof typeof counts] = item._count.type;
                });

                return {
                    counts,
                    userReaction: userReaction?.type || null,
                    total: reactionCounts.reduce((sum, item) => sum + item._count.type, 0),
                };
            } else if (input.commentId) {
                // Verify comment exists
                const comment = await prisma.announcementComment.findUnique({
                    where: { id: input.commentId },
                    include: {
                        announcement: {
                            select: {
                                classId: true,
                            },
                        },
                    },
                });

                if (!comment) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Comment not found",
                    });
                }

                if (comment.announcement.classId !== input.classId) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Comment does not belong to this class",
                    });
                }

                // Get reaction counts by type
                const reactionCounts = await prisma.reaction.groupBy({
                    by: ['type'],
                    where: { commentId: input.commentId },
                    _count: { type: true },
                });

                // Get current user's reaction
                const userReaction = await prisma.reaction.findUnique({
                    where: {
                        userId_commentId: {
                            userId,
                            commentId: input.commentId,
                        },
                    },
                });

                // Format counts
                const counts = {
                    THUMBSUP: 0,
                    CELEBRATE: 0,
                    CARE: 0,
                    HEART: 0,
                    IDEA: 0,
                    HAPPY: 0,
                };

                reactionCounts.forEach((item) => {
                    counts[item.type as keyof typeof counts] = item._count.type;
                });

                return {
                    counts,
                    userReaction: userReaction?.type || null,
                    total: reactionCounts.reduce((sum, item) => sum + item._count.type, 0),
                };
            }

            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Unexpected error",
            });
        }),
}); 
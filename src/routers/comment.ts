import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";

export const commentSelect = {
    id: true,
    content: true,
    createdAt: true,
    modifiedAt: true,
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
    reactions: {
        select: {
            type: true,
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
    },
};

export const commentRouter = createTRPCRouter({
    get: protectedProcedure
    .input(z.object({
        id: z.string(),
    }))
    .query(async ({ ctx, input }) => {
        const comment = await prisma.comment.findUnique({
            where: { id: input.id },
            select: {
                ...commentSelect,
            }
        });
        if (!comment) {
            throw new TRPCError({
                code: "NOT_FOUND",
                message: "Comment not found",
            });
        }

        return comment;
    }),
    getReplies: protectedProcedure
    .input(z.object({
        commentId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
        const replies = await prisma.comment.findMany({
            where: { parentCommentId: input.commentId
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
            }
        });
        return replies;
    }),
    replyToComment: protectedProcedure
    .input(z.object({
        parentCommentId: z.string(),
        content: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
        const { parentCommentId, content } = input;

        const newComment = await prisma.comment.create({
            data: {
                parentCommentId,
                content,
                authorId: ctx.user!.id,
            },
        });

        return newComment;
    }), 
    addReaction: protectedProcedure
    .input(z.object({
        id: z.string(),
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
        const comment = await prisma.comment.findUnique({
            where: { id: input.id },
        });

        const userId = ctx.user.id;

        // Verify the announcement or comment exists and belongs to the class
        if (comment) {
            const announcement = await prisma.announcement.findFirst({
                where: {
                    id: input.id,
                },
            });

            // Upsert reaction: update if exists, create if not
            const reaction = await prisma.reaction.upsert({
                where: {
                    userId_commentId: {
                        userId,
                        commentId: input.id,
                    },
                },
                update: {
                    type: input.type,
                },
                create: {
                    type: input.type,
                    userId,
                    commentId: input.id,
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
        if (!input.commentId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Either announcementId or commentId must be provided",
            });
        }

        const userId = ctx.user.id;

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

    }),

getReactions: protectedProcedure
    .input(z.object({
        commentId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
        if (!ctx.user) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "User must be authenticated",
            });
        }

        // Exactly one of announcementId or commentId must be provided
        if (!input.commentId) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Either announcementId or commentId must be provided",
            });
        }

        const userId = ctx.user.id;

            // Verify comment exists
            const comment = await prisma.comment.findUnique({
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
    }),
});
import { z } from "zod";
import { createTRPCRouter, protectedClassMemberProcedure, protectedTeacherProcedure, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";

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
                select: AnnouncementSelect,
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return {
                announcements,
            };
        }),

    create: protectedTeacherProcedure
        .input(z.object({
            classId: z.string(),
            remarks: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            const announcement = await prisma.announcement.create({
                data: {
                    remarks: input.remarks,
                    teacher: {
                        connect: {
                            id: ctx.user?.id,
                        },
                    },
                    class: {
                        connect: {
                            id: input.classId,
                        },
                    },
                },
                select: AnnouncementSelect,
            });

            return {
                announcement,
            };
        }),

    update: protectedProcedure
        .input(z.object({
            id: z.string(),
            data: z.object({
                content: z.string(),
            }),
        }))
        .mutation(async ({ ctx, input }) => {

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

            const updatedAnnouncement = await prisma.announcement.update({
                where: { id: input.id },
                data: {
                    remarks: input.data.content,
                },
            });

            return { announcement: updatedAnnouncement };
        }),

    delete: protectedProcedure
        .input(z.object({
            id: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {

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

            await prisma.announcement.delete({
                where: { id: input.id },
            });

            return { success: true };
        }),
}); 
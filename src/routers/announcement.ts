import { z } from "zod";
import { createTRPCRouter, protectedClassMemberProcedure, protectedTeacherProcedure, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";
import { sendNotifications } from "../lib/notificationHandler.js";
import { logger } from "../utils/logger.js";

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
            const classId = input.classId
            const remarks = input.remarks

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
                            id: ctx.user?.id,
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

            sendNotifications(classData.students.map(student => student.id), {
                title: `🔔 Announcement for ${classData.name}`,
                content: remarks
            }).catch(error => {
                logger.error('Failed to send announcement notifications:');
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
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import redis from "../lib/redis";
import {
  createTRPCRouter,
  protectedClassMemberProcedure,
  protectedProcedure,
  protectedTeacherProcedure,
} from "../trpc";

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
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Try getting data from Redis
      const cacheKey = `announcement:${input.classId}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        console.log("cached announcement found", cached);
        return JSON.parse(cached);
      }

      const announcements = await prisma.announcement.findMany({
        where: {
          classId: input.classId,
        },
        select: AnnouncementSelect,
        orderBy: {
          createdAt: "desc",
        },
      });

      const data = { announcements };

      // Store in Redis (set cache for 10 mins)
      await redis.set(cacheKey, JSON.stringify(data), {
        EX: 600, // 600 seconds = 10 minutes
      });

      console.log("announcement data fetched from DB", data);

      return data;
    }),

  create: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        remarks: z.string(),
      })
    )
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

      // Invalidate cache for the specific class
      const cacheKey = `announcement:${input.classId}`;
      await redis.del(cacheKey);

      // Invalidate cache for the class
      await redis.del(`classes:${input.classId}`);

      return {
        announcement,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          content: z.string(),
        }),
      })
    )
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

      // ✅ Authorization guard — only teachers of this class can update
      const isTeacher = announcement.class.teachers.some(
        (t) => t.id === ctx.user?.id
      );
      if (!isTeacher) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not authorized to update this announcement",
        });
      }

      const updatedAnnouncement = await prisma.announcement.update({
        where: { id: input.id },
        data: {
          remarks: input.data.content,
        },
      });

      // Invalidate cache for the specific announcement
      const cacheKey = `announcement:${announcement.classId}`;
      await redis.del(cacheKey);

      // Invalidate cache for the class
      await redis.del(`classes:${announcement.classId}`);

      return { announcement: updatedAnnouncement };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
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

      // ✅ Authorization guard — only teachers of this class can update
      const isTeacher = announcement.class.teachers.some(
        (t) => t.id === ctx.user?.id
      );
      if (!isTeacher) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not authorized to update this announcement",
        });
      }

      await prisma.announcement.delete({
        where: { id: input.id },
      });

      // Invalidate cache for the specific announcement
      const cacheKey = `announcement:${announcement.classId}`;
      await redis.del(cacheKey);

      // Invalidate cache for the class
      await redis.del(`classes:${announcement.classId}`);

      return { success: true };
    }),
});

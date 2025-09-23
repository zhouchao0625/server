import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";

const createSectionSchema = z.object({
  classId: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

const updateSectionSchema = z.object({
  id: z.string(),
  classId: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

const deleteSectionSchema = z.object({
  id: z.string(),
  classId: z.string(),
});

export const sectionRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createSectionSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: input.classId,
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

      const section = await prisma.section.create({
        data: {
          name: input.name,
          order: 0,
          class: {
            connect: { id: input.classId },
          },
          ...(input.color && {
            color: input.color,
          }),
        },
      });

      // find all root items in the class and reorder them
      const sections = await prisma.section.findMany({
        where: {
          classId: input.classId,
        },
      });

      const assignments = await prisma.assignment.findMany({
        where: {
          classId: input.classId,
          sectionId: null,
        },
      });

      const stack = [...sections, ...assignments].sort((a, b) => (a.order || 0) - (b.order || 0)).map((item, index) => ({
        id: item.id,
        order: index + 1,
      })).map((item) => ({
        where: { id: item.id },
        data: { order: item.order },
      }));

      // Update sections and assignments with their new order
      await Promise.all([
        ...stack.filter(item => sections.some(s => s.id === item.where.id))
          .map(({ where, data }) => 
            prisma.section.update({ where, data })
          ),
        ...stack.filter(item => assignments.some(a => a.id === item.where.id))
          .map(({ where, data }) => 
            prisma.assignment.update({ where, data })
          )
      ]);

      return section;
    }),

  update: protectedProcedure
    .input(updateSectionSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: input.classId,
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

      const section = await prisma.section.update({
        where: { id: input.id },
        data: {
          name: input.name,
          ...(input.color && {
            color: input.color,
          }),
        },
      });

      return section;
    }),

  reOrder: protectedProcedure
    .input(z.object({
      id: z.string(),
      classId: z.string(),
      order: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: input.classId,
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

      await prisma.section.update({
        where: { id: input.id },
        data: {
          order: input.order,
        },
      });

      return { id: input.id };
    }),

  delete: protectedProcedure
    .input(deleteSectionSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: input.classId,
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

      await prisma.section.delete({
        where: { id: input.id },
      });

      return { id: input.id };
    }),
}); 
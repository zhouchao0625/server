import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma";

const createSectionSchema = z.object({
  classId: z.string(),
  name: z.string(),
});

const updateSectionSchema = z.object({
  id: z.string(),
  classId: z.string(),
  name: z.string(),
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
          class: {
            connect: { id: input.classId },
          },
        },
      });

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
        },
      });

      return section;
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
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

      // Insert new section at top of unified list (sections + assignments) and normalize
      const [sections, assignments] = await Promise.all([
        prisma.section.findMany({
          where: { classId: input.classId },
          select: { id: true, order: true },
        }),
        prisma.assignment.findMany({
          where: { classId: input.classId },
          select: { id: true, order: true },
        }),
      ]);

      const unified = [
        ...sections.map(s => ({ id: s.id, order: s.order, type: 'section' as const })),
        ...assignments.map(a => ({ id: a.id, order: a.order, type: 'assignment' as const })),
      ].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

      const withoutNew = unified.filter(item => !(item.id === section.id && item.type === 'section'));
      const reindexed = [{ id: section.id, type: 'section' as const }, ...withoutNew.map(item => ({ id: item.id, type: item.type }))];

      await Promise.all(
        reindexed.map((item, index) => {
          if (item.type === 'section') {
            return prisma.section.update({ where: { id: item.id }, data: { order: index + 1 } });
          } else {
            return prisma.assignment.update({ where: { id: item.id }, data: { order: index + 1 } });
          }
        })
      );

      return section;
    }),

  reorder: protectedProcedure
    .input(z.object({
      classId: z.string(),
      movedId: z.string(), // Section ID
      // One of: place at start/end of unified list, or relative to targetId (can be section or assignment)
      position: z.enum(['start', 'end', 'before', 'after']),
      targetId: z.string().optional(), // Can be a section ID or assignment ID
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { classId, movedId, position, targetId } = input;

      const moved = await prisma.section.findFirst({
        where: { id: movedId, classId },
        select: { id: true, classId: true },
      });

      if (!moved) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Section not found' });
      }

      if ((position === 'before' || position === 'after') && !targetId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'targetId required for before/after' });
      }

      const result = await prisma.$transaction(async (tx) => {
        const [sections, assignments] = await Promise.all([
          tx.section.findMany({
            where: { classId },
            select: { id: true, order: true },
          }),
          tx.assignment.findMany({
            where: { classId },
            select: { id: true, order: true },
          }),
        ]);

        const unified = [
          ...sections.map(s => ({ id: s.id, order: s.order, type: 'section' as const })),
          ...assignments.map(a => ({ id: a.id, order: a.order, type: 'assignment' as const })),
        ].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

        const movedIdx = unified.findIndex(item => item.id === movedId && item.type === 'section');
        if (movedIdx === -1) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Section not found in unified list' });
        }

        const withoutMoved = unified.filter(item => !(item.id === movedId && item.type === 'section'));

        let next: Array<{ id: string; type: 'section' | 'assignment' }> = [];

        if (position === 'start') {
          next = [{ id: movedId, type: 'section' }, ...withoutMoved.map(item => ({ id: item.id, type: item.type }))];
        } else if (position === 'end') {
          next = [...withoutMoved.map(item => ({ id: item.id, type: item.type })), { id: movedId, type: 'section' }];
        } else {
          const targetIdx = withoutMoved.findIndex(item => item.id === targetId);
          if (targetIdx === -1) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'targetId not found in unified list' });
          }
          if (position === 'before') {
            next = [
              ...withoutMoved.slice(0, targetIdx).map(item => ({ id: item.id, type: item.type })),
              { id: movedId, type: 'section' },
              ...withoutMoved.slice(targetIdx).map(item => ({ id: item.id, type: item.type })),
            ];
          } else {
            next = [
              ...withoutMoved.slice(0, targetIdx + 1).map(item => ({ id: item.id, type: item.type })),
              { id: movedId, type: 'section' },
              ...withoutMoved.slice(targetIdx + 1).map(item => ({ id: item.id, type: item.type })),
            ];
          }
        }

        // Normalize to 1..n
        await Promise.all(
          next.map((item, index) => {
            if (item.type === 'section') {
              return tx.section.update({ where: { id: item.id }, data: { order: index + 1 } });
            } else {
              return tx.assignment.update({ where: { id: item.id }, data: { order: index + 1 } });
            }
          })
        );

        return tx.section.findUnique({ where: { id: movedId } });
      });

      return result;
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

      // Update order and normalize unified list
      await prisma.$transaction(async (tx) => {
        await tx.section.update({
          where: { id: input.id },
          data: { order: input.order },
        });

        // Normalize entire unified list
        const [sections, assignments] = await Promise.all([
          tx.section.findMany({
            where: { classId: input.classId },
            select: { id: true, order: true },
          }),
          tx.assignment.findMany({
            where: { classId: input.classId },
            select: { id: true, order: true },
          }),
        ]);

        const unified = [
          ...sections.map(s => ({ id: s.id, order: s.order, type: 'section' as const })),
          ...assignments.map(a => ({ id: a.id, order: a.order, type: 'assignment' as const })),
        ].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

        await Promise.all(
          unified.map((item, index) => {
            if (item.type === 'section') {
              return tx.section.update({ where: { id: item.id }, data: { order: index + 1 } });
            } else {
              return tx.assignment.update({ where: { id: item.id }, data: { order: index + 1 } });
            }
          })
        );
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
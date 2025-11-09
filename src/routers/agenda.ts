import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";
import { addDays, startOfDay, endOfDay } from "date-fns";

export const agendaRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({
      weekStart: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to get your agenda",
        });
      }

      const weekStart = startOfDay(new Date(input.weekStart));
      const weekEnd = endOfDay(addDays(weekStart, 6));

      const [personalEvents, classEvents] = await Promise.all([
        // Get personal events
        prisma.event.findMany({
          where: {
            userId: ctx.user.id,
            startTime: {
              gte: weekStart,
              lte: weekEnd,
            },
            class: {
              is: null,
            },
          },
          include: {
            class: true,
          },
        }),
        // Get class events
        prisma.event.findMany({
          where: {
            class: {
              OR: [
                {
                  teachers: {
                    some: {
                      id: ctx.user.id,
                    },
                  },
                },
                {
                  students: {
                    some: {
                      id: ctx.user.id,
                    },
                  },
                },
              ],
            },
            startTime: {
              gte: weekStart,
              lte: weekEnd,
            },
          },
          include: {
            class: true,
          },
        }),
      ]);

      return {
        events: {
          personal: personalEvents,
          class: classEvents,
        },
      };
    }),
}); 
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";
import { addDays, addMonths, subMonths, startOfDay, endOfDay } from "date-fns";

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

      // Expand query range to 6 months (3 months before and after the reference date)
      // to allow calendar navigation and ensure newly created events are visible
      const referenceDate = new Date(input.weekStart);
      const rangeStart = startOfDay(subMonths(referenceDate, 3));
      const rangeEnd = endOfDay(addMonths(referenceDate, 3));

      const [personalEvents, classEvents] = await Promise.all([
        // Get personal events
        prisma.event.findMany({
          where: {
            userId: ctx.user.id,
            startTime: {
              gte: rangeStart,
              lte: rangeEnd,
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
              gte: rangeStart,
              lte: rangeEnd,
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
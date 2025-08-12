import { TRPCError } from "@trpc/server";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import redis from "../lib/redis";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const agendaRouter = createTRPCRouter({
  get: protectedProcedure
    .input(
      z.object({
        weekStart: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to get your agenda",
        });
      }

      const cacheKey = `agenda:${ctx.user.id}:${input.weekStart}`;

      // Try getting data from Redis
      const cached = await redis.get(cacheKey);
      console.log("agenda Cache hit:", cached);
      if (cached) {
        return JSON.parse(cached);
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

      const data = {
        events: {
          personal: personalEvents,
          class: classEvents,
        },
      };

      // Store in Redis (set cache for 10 mins)
      await redis.set(cacheKey, JSON.stringify(data), {
        EX: 600, // 600 seconds = 10 minutes
      });

      return data;
    }),
});

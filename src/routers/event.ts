import { TRPCError } from "@trpc/server";
import { parseISO } from "date-fns";
import redis from "src/lib/redis";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const eventSchema = z.object({
  name: z.string().optional(),
  location: z.string().optional(),
  remarks: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  classId: z.string().optional(),
  color: z.string().optional(),
});

export const eventRouter = createTRPCRouter({
  get: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to get an event",
        });
      }

      // Try getting data from Redis
      const cacheKey = `event:${ctx.user.id}:${input.id}`;
      const cached = await redis.get(cacheKey);
      console.log("class Cache hit:", cached);
      if (cached) {
        return JSON.parse(cached);
      }

      const event = await prisma.event.findUnique({
        where: { id: input.id },
        include: {
          class: true,
          user: true,
          assignmentsAttached: {
            select: {
              id: true,
              title: true,
              instructions: true,
              dueDate: true,
              type: true,
              graded: true,
              maxGrade: true,
              weight: true,
              attachments: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                },
              },
              section: {
                select: {
                  id: true,
                  name: true,
                },
              },
              teacher: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
        },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      if (event.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this event",
        });
      }

      // Store in Redis (set cache for 10 mins)
      await redis.set(cacheKey, JSON.stringify({ event }), {
        EX: 600, // 600 seconds = 10 minutes
      });

      return { event };
    }),

  create: protectedProcedure
    .input(eventSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to create an event",
        });
      }

      // If classId is provided, check if user is a teacher of the class
      if (input.classId) {
        const classData = await prisma.class.findUnique({
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
            code: "UNAUTHORIZED",
            message: "You are not authorized to create events for this class",
          });
        }
      }

      const event = await prisma.event.create({
        data: {
          name: input.name,
          location: input.location,
          remarks: input.remarks,
          startTime: parseISO(input.startTime),
          endTime: parseISO(input.endTime),
          userId: ctx.user.id,
          color: input.color,
          ...(input.classId ? { classId: input.classId } : {}),
        },
        select: {
          id: true,
          name: true,
          location: true,
          remarks: true,
          startTime: true,
          endTime: true,
          color: true,
          classId: true,
          userId: true,
          class: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const cacheKey = `event:${ctx.user.id}:${event.id}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${input.classId}`);

      return { event };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: eventSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to update an event",
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: input.id },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      if (event.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to update this event",
        });
      }

      const updatedEvent = await prisma.event.update({
        where: { id: input.id },
        data: {
          name: input.data.name,
          location: input.data.location,
          remarks: input.data.remarks,
          startTime: parseISO(input.data.startTime),
          endTime: parseISO(input.data.endTime),
          color: input.data.color,
          ...(input.data.classId ? { classId: input.data.classId } : {}),
        },
      });

      const cacheKey = `event:${ctx.user.id}:${event.id}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${event?.classId}`);

      return { event: updatedEvent };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to delete an event",
        });
      }

      const event = await prisma.event.findUnique({
        where: { id: input.id },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      if (event.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to delete this event",
        });
      }

      await prisma.event.delete({
        where: { id: input.id },
      });

      const cacheKey = `event:${ctx.user.id}:${event.id}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${event?.classId}`);

      return { success: true };
    }),

  attachAssignment: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        assignmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user || !ctx.user.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to attach an assignment",
        });
      }

      // Check if user owns the event
      const event = await prisma.event.findUnique({
        where: { id: input.eventId },
        include: {
          class: {
            include: {
              teachers: {
                select: { id: true },
              },
            },
          },
        },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Check if user is the event owner or a teacher of the class
      if (
        event.userId !== ctx.user.id &&
        !event.class?.teachers.some((teacher) => teacher.id === ctx.user!.id)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to modify this event",
        });
      }

      // Check if assignment exists and belongs to the same class
      const assignment = await prisma.assignment.findUnique({
        where: { id: input.assignmentId },
        include: {
          class: {
            include: {
              teachers: {
                select: { id: true },
              },
            },
          },
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      // Check if user is a teacher of the assignment's class
      if (
        !assignment.class.teachers.some(
          (teacher) => teacher.id === ctx.user!.id
        )
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to modify this assignment",
        });
      }

      // Check if event and assignment belong to the same class
      if (event.classId !== assignment.classId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Event and assignment must belong to the same class",
        });
      }

      // Attach assignment to event
      const updatedAssignment = await prisma.assignment.update({
        where: { id: input.assignmentId },
        data: {
          eventAttached: {
            connect: { id: input.eventId },
          },
        },
        include: {
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          section: {
            select: {
              id: true,
              name: true,
            },
          },
          teacher: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      const cacheKey = `event:${ctx.user.id}:${event.id}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${event?.classId}`);

      return { assignment: updatedAssignment };
    }),

  detachAssignment: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        assignmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to detach an assignment",
        });
      }

      // Check if user owns the event
      const event = await prisma.event.findUnique({
        where: { id: input.eventId },
        include: {
          class: {
            include: {
              teachers: {
                select: { id: true },
              },
            },
          },
        },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Check if user is the event owner or a teacher of the class
      if (
        event.userId !== ctx.user.id &&
        !event.class?.teachers.some((teacher) => teacher.id === ctx.user!.id)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to modify this event",
        });
      }

      // Detach assignment from event
      const updatedAssignment = await prisma.assignment.update({
        where: { id: input.assignmentId },
        data: {
          eventAttached: {
            disconnect: true,
          },
        },
        include: {
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          section: {
            select: {
              id: true,
              name: true,
            },
          },
          teacher: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      const cacheKey = `event:${ctx.user.id}:${event.id}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${event?.classId}`);

      return { assignment: updatedAssignment };
    }),

  getAvailableAssignments: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to get available assignments",
        });
      }

      // Get the event to find the class
      const event = await prisma.event.findUnique({
        where: { id: input.eventId },
        include: {
          class: {
            include: {
              teachers: {
                select: { id: true },
              },
            },
          },
        },
      });

      if (!event || !event.classId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Check if user is authorized to access this event/class
      if (
        event.userId !== ctx.user.id &&
        !event.class?.teachers.some((teacher) => teacher.id === ctx.user!.id)
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to access this event",
        });
      }

      // Get all assignments for the class that are not already attached to an event
      const assignments = await prisma.assignment.findMany({
        where: {
          classId: event.classId,
          eventId: null, // Not already attached to any event
        },
        select: {
          id: true,
          title: true,
          instructions: true,
          dueDate: true,
          type: true,
          graded: true,
          maxGrade: true,
          weight: true,
          section: {
            select: {
              id: true,
              name: true,
            },
          },
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          teacher: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return { assignments };
    }),
});

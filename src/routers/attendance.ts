import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";

const attendanceSchema = z.object({
  eventId: z.string().optional(),
  present: z.array(z.object({ id: z.string(), username: z.string() })),
  late: z.array(z.object({ id: z.string(), username: z.string() })),
  absent: z.array(z.object({ id: z.string(), username: z.string() })),
});

export const attendanceRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({
      classId: z.string(),
      eventId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to view attendance",
        });
      }

      // Check if user is a teacher or student of the class
      const classData = await prisma.class.findUnique({
        where: {
          id: input.classId,
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
        select: {
          students: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this class's attendance",
        });
      }

      // check each event has an attendance, if not create one
      const events = await prisma.event.findMany({
        where: {
          classId: input.classId,
        },
      });
      
      for (const event of events) {
        const attendance = await prisma.attendance.findFirst({
          where: {
            eventId: event.id,
          },
        });
        
        if (!attendance) {
          await prisma.attendance.create({
            data: {
              event: {
                connect: {
                  id: event.id,
                },
              },
              class: {
                connect: {
                  id: input.classId,
                },
              },
              present: {
                connect: classData.students.map(student => ({ id: student.id })),
              },
            },
          });
        }
      }


      const attendance = await prisma.attendance.findMany({
        where: {
          classId: input.classId,
          ...(input.eventId ? { eventId: input.eventId } : {}),
        },
        include: {
          event: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
              location: true,
              color: true,
            },
          },
          present: {
            select: {
              id: true,
              username: true,
            },
          },
          late: {
            select: {
              id: true,
              username: true,
            },
          },
          absent: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: {
          date: "desc",
        },
      });

      return attendance;
    }),

  update: protectedProcedure
    .input(z.object({
      classId: z.string(),
      eventId: z.string().optional(),
      attendance: attendanceSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to update attendance",
        });
      }

      // Check if user is a teacher of the class
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
          message: "You are not authorized to update this class's attendance",
        });
      }

      // Check if attendance record exists
      const existingAttendance = await prisma.attendance.findFirst({
        where: {
          classId: input.classId,
          eventId: input.eventId,
        },
      });

      if (!existingAttendance) {
        // Create new attendance record
        const attendance = await prisma.attendance.create({
          data: {
            classId: input.classId,
            eventId: input.eventId,
            date: new Date(),
            present: {
              connect: input.attendance.present.map(student => ({ id: student.id })),
            },
            late: {
              connect: input.attendance.late.map(student => ({ id: student.id })),
            },
            absent: {
              connect: input.attendance.absent.map(student => ({ id: student.id })),
            },
          },
          include: {
            event: {
              select: {
                id: true,
                name: true,
                startTime: true,
                endTime: true,
                location: true,
              },
            },
            present: {
              select: {
                id: true,
                username: true,
              },
            },
            late: {
              select: {
                id: true,
                username: true,
              },
            },
            absent: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        });

        return attendance;
      }

      // Update existing attendance record
      const attendance = await prisma.attendance.update({
        where: {
          id: existingAttendance.id,
        },
        data: {
          present: {
            set: input.attendance.present.map(student => ({ id: student.id })),
          },
          late: {
            set: input.attendance.late.map(student => ({ id: student.id })),
          },
          absent: {
            set: input.attendance.absent.map(student => ({ id: student.id })),
          },
        },
        include: {
          event: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
              location: true,
            },
          },
          present: {
            select: {
              id: true,
              username: true,
            },
          },
          late: {
            select: {
              id: true,
              username: true,
            },
          },
          absent: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return attendance;
    }),
}); 
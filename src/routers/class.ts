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
import { generateInviteCode } from "../utils/generateInviteCode";

export const classRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const cacheKey = `classes:${ctx.user?.id}`;

    // Try getting data from Redis
    const cached = await redis.get(cacheKey);
    console.log("class Cache hit:", cached);
    if (cached) {
      return JSON.parse(cached);
    }

    const [teacherClasses, studentClasses] = await Promise.all([
      prisma.class.findMany({
        where: {
          teachers: {
            some: {
              id: ctx.user?.id,
            },
          },
        },
        include: {
          assignments: {
            where: {
              dueDate: {
                equals: new Date(new Date().setHours(0, 0, 0, 0)),
              },
            },
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
      prisma.class.findMany({
        where: {
          students: {
            some: {
              id: ctx.user?.id,
            },
          },
        },
        include: {
          assignments: {
            where: {
              dueDate: {
                equals: new Date(new Date().setHours(0, 0, 0, 0)),
              },
            },
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
    ]);

    const adminClasses = await prisma.class.findMany({
      where: {
        teachers: {
          some: {
            id: ctx.user?.id,
          },
        },
      },
      include: {
        assignments: {
          where: {
            dueDate: {
              equals: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    const data = {
      teacherInClass: teacherClasses.map((cls) => ({
        id: cls.id,
        name: cls.name,
        section: cls.section,
        subject: cls.subject,
        dueToday: cls.assignments,
        color: cls.color,
      })),
      studentInClass: studentClasses.map((cls) => ({
        id: cls.id,
        name: cls.name,
        section: cls.section,
        subject: cls.subject,
        dueToday: cls.assignments,
        color: cls.color,
      })),
      adminInClass: adminClasses.map((cls) => ({
        id: cls.id,
        name: cls.name,
        section: cls.section,
        subject: cls.subject,
        dueToday: cls.assignments,
        color: cls.color,
      })),
    };

    // Store in Redis (set cache for 10 mins)
    await redis.set(cacheKey, JSON.stringify(data), {
      EX: 600, // 600 seconds = 10 minutes
    });

    return data;
  }),
  get: protectedProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const cacheKey = `classes:${classId}`;

      // Try getting data from Redis
      const cached = await redis.get(cacheKey);
      console.log(`class ${classId} Cache hit:`, cached);
      if (cached) {
        return JSON.parse(cached);
      }

      const classData = await prisma.class.findUnique({
        where: {
          id: classId,
        },
        include: {
          teachers: {
            select: {
              id: true,
              username: true,
            },
          },
          students: {
            select: {
              id: true,
              username: true,
            },
          },
          announcements: {
            orderBy: {
              createdAt: "desc",
            },
            select: {
              id: true,
              remarks: true,
              createdAt: true,
              teacher: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          assignments: {
            select: {
              type: true,
              id: true,
              title: true,
              dueDate: true,
              createdAt: true,
              weight: true,
              graded: true,
              maxGrade: true,
              instructions: true,
              section: {
                select: {
                  id: true,
                  name: true,
                },
              },
              markScheme: {
                select: {
                  id: true,
                  structured: true,
                },
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                },
              },
              submissions: {
                where: {
                  studentId: ctx.user?.id,
                },
                select: {
                  studentId: true,
                  id: true,
                  submitted: true,
                  returned: true,
                  submittedAt: true,
                },
              },
            },
          },
        },
      });

      const sections = await prisma.section.findMany({
        where: {
          classId: classId,
        },
      });

      if (!classData) {
        throw new Error("Class not found");
      }

      const data = {
        class: {
          ...classData,
          assignments: classData.assignments.map((assignment) => ({
            ...assignment,
            late: assignment.dueDate < new Date(),
            submitted: assignment.submissions.some(
              (submission) => submission.studentId === ctx.user?.id
            ),
            returned: assignment.submissions.some(
              (submission) =>
                submission.studentId === ctx.user?.id && submission.returned
            ),
          })),
          sections,
        },
      };

      // Store in Redis (set cache for 10 mins)
      await redis.set(cacheKey, JSON.stringify(data), {
        EX: 600, // 600 seconds = 10 minutes
      });

      return data;
    }),
  update: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        name: z.string().optional(),
        section: z.string().optional(),
        subject: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, ...updateData } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const updatedClass = await prisma.class.update({
        where: {
          id: classId,
        },
        data: updateData,
        select: {
          id: true,
          name: true,
          section: true,
          subject: true,
        },
      });

      return {
        updatedClass,
      };
    }),
  create: protectedProcedure
    .input(
      z.object({
        students: z.array(z.string()).optional(),
        teachers: z.array(z.string()).optional(),
        name: z.string(),
        section: z.string(),
        subject: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { students, teachers, name, section, subject } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      if (teachers && teachers.length > 0 && students && students.length > 0) {
        const newClass = await prisma.class.create({
          data: {
            name,
            section,
            subject,
            teachers: {
              connect: teachers.map((teacher) => ({ id: teacher })),
            },
            students: {
              connect: students.map((student) => ({ id: student })),
            },
          },
          include: {
            teachers: true,
            students: true,
          },
        });
        return newClass;
      }

      const newClass = await prisma.class.create({
        data: {
          name,
          section,
          subject,
          teachers: {
            connect: {
              id: ctx.user?.id,
            },
          },
        },
      });

      return newClass;
    }),
  delete: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      // Verify user is the teacher of this class
      const classToDelete = await prisma.class.findFirst({
        where: {
          id: input.id,
        },
      });

      if (!classToDelete) {
        throw new Error(
          "Class not found or you don't have permission to delete it"
        );
      }

      await prisma.class.delete({
        where: {
          id: input.id,
        },
      });

      return {
        deletedClass: {
          id: input.id,
        },
      };
    }),
  addStudent: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        studentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, studentId } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const student = await prisma.user.findUnique({
        where: {
          id: studentId,
        },
      });

      if (!student) {
        throw new Error("Student not found");
      }

      const updatedClass = await prisma.class.update({
        where: {
          id: classId,
        },
        data: {
          students: {
            connect: {
              id: studentId,
            },
          },
        },
        select: {
          id: true,
          name: true,
          section: true,
          subject: true,
        },
      });

      return {
        updatedClass,
        newStudent: student,
      };
    }),
  changeRole: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        userId: z.string(),
        type: z.enum(["teacher", "student"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, userId, type } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      const updatedClass = await prisma.class.update({
        where: { id: classId },
        data: {
          [type === "teacher" ? "teachers" : "students"]: {
            connect: { id: userId },
          },
          [type === "teacher" ? "students" : "teachers"]: {
            disconnect: { id: userId },
          },
        },
      });

      return {
        updatedClass,
        user: {
          ...user,
          type,
        },
      };
    }),
  removeMember: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, userId } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const updatedClass = await prisma.class.update({
        where: { id: classId },
        data: {
          teachers: {
            disconnect: { id: userId },
          },
          students: {
            disconnect: { id: userId },
          },
        },
      });

      return {
        updatedClass,
        removedUserId: userId,
      };
    }),
  join: protectedProcedure
    .input(
      z.object({
        classCode: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classCode } = input;

      const session = await prisma.session.findFirst({
        where: {
          id: classCode,
        },
      });

      if (!session || !session.classId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Class not found",
        });
      }

      if (session.expiresAt && session.expiresAt < new Date()) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session expired",
        });
      }

      const updatedClass = await prisma.class.update({
        where: { id: session.classId },
        data: {
          students: {
            connect: { id: ctx.user?.id },
          },
        },
        select: {
          id: true,
          name: true,
          section: true,
          subject: true,
        },
      });

      return {
        joinedClass: updatedClass,
      };
    }),
  getInviteCode: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const session = await prisma.session.findFirst({
        where: {
          classId,
        },
      });

      if ((session?.expiresAt && session.expiresAt < new Date()) || !session) {
        const newSession = await prisma.session.create({
          data: {
            id: generateInviteCode(),
            classId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
          },
        });
        return {
          code: newSession.id,
        };
      }

      return {
        code: session?.id,
      };
    }),
  createInviteCode: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId } = input;

      // Create a new session for the invite code
      const session = await prisma.session.create({
        data: {
          id: generateInviteCode(),
          classId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        },
      });

      return {
        code: session.id,
      };
    }),
  getGrades: protectedClassMemberProcedure
    .input(
      z.object({
        classId: z.string(),
        userId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { classId, userId } = input;

      const isTeacher = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: { id: ctx.user?.id },
          },
        },
      });
      // If student, only allow viewing their own grades
      if (ctx.user?.id !== userId && !isTeacher) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You can only view your own grades",
        });
      }

      const grades = await prisma.submission.findMany({
        where: {
          studentId: userId,
          assignment: {
            classId: classId,
            graded: true,
          },
        },
        include: {
          assignment: {
            select: {
              id: true,
              title: true,
              maxGrade: true,
              weight: true,
            },
          },
        },
      });

      return {
        grades,
      };
    }),
  updateGrade: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        assignmentId: z.string(),
        submissionId: z.string(),
        gradeReceived: z.number().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, assignmentId, submissionId, gradeReceived } = input;

      // Update the grade
      const updatedSubmission = await prisma.submission.update({
        where: {
          id: submissionId,
          assignmentId: assignmentId,
        },
        data: {
          gradeReceived,
        },
        include: {
          assignment: {
            select: {
              id: true,
              title: true,
              maxGrade: true,
              weight: true,
            },
          },
        },
      });

      return updatedSubmission;
    }),
  getEvents: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const events = await prisma.event.findMany({
        where: {
          class: {
            id: classId,
          },
        },
        select: {
          name: true,
          startTime: true,
          endTime: true,
        },
      });

      return events;
    }),
  listMarkSchemes: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const markSchemes = await prisma.markScheme.findMany({
        where: {
          classId: classId,
        },
      });

      return markSchemes;
    }),
  createMarkScheme: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        structure: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, structure } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const validatedStructure = structure.replace(/\\n/g, "\n");

      const markScheme = await prisma.markScheme.create({
        data: {
          classId: classId,
          structured: validatedStructure,
        },
      });

      return markScheme;
    }),
  updateMarkScheme: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        markSchemeId: z.string(),
        structure: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, markSchemeId, structure } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const validatedStructure = structure.replace(/\\n/g, "\n");

      const markScheme = await prisma.markScheme.update({
        where: { id: markSchemeId },
        data: { structured: validatedStructure },
      });

      return markScheme;
    }),
  deleteMarkScheme: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        markSchemeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, markSchemeId } = input;

      const cacheKey = `classes:${ctx.user?.id}`;

      await redis.del(cacheKey);

      const markScheme = await prisma.markScheme.delete({
        where: { id: markSchemeId },
      });

      return markScheme;
    }),
  listGradingBoundaries: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const gradingBoundaries = await prisma.gradingBoundary.findMany({
        where: {
          classId: classId,
        },
      });

      return gradingBoundaries;
    }),
  createGradingBoundary: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        structure: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, structure } = input;

      const validatedStructure = structure.replace(/\\n/g, "\n");

      const gradingBoundary = await prisma.gradingBoundary.create({
        data: {
          classId: classId,
          structured: validatedStructure,
        },
      });

      return gradingBoundary;
    }),
  updateGradingBoundary: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        gradingBoundaryId: z.string(),
        structure: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, gradingBoundaryId, structure } = input;

      const validatedStructure = structure.replace(/\\n/g, "\n");

      const gradingBoundary = await prisma.gradingBoundary.update({
        where: { id: gradingBoundaryId },
        data: { structured: validatedStructure },
      });

      return gradingBoundary;
    }),
  deleteGradingBoundary: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        gradingBoundaryId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { classId, gradingBoundaryId } = input;

      const gradingBoundary = await prisma.gradingBoundary.delete({
        where: { id: gradingBoundaryId },
      });

      return gradingBoundary;
    }),
});

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, protectedTeacherProcedure, protectedClassMemberProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { TRPCError } from "@trpc/server";
import { generateInviteCode } from "../utils/generateInviteCode.js";

export const classRouter = createTRPCRouter({
  getAll: protectedProcedure
  
    .query(async ({ ctx }) => {
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
                  lte: new Date(new Date().setHours(23, 59, 59, 999)),
                },
                template: false,
              },
              select: {
                id: true,
                title: true,
                type: true,
                dueDate: true,
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
                  lte: new Date(new Date().setHours(23, 59, 59, 999)),
                },
                template: false,
              },
              select: {
                id: true,
                title: true,
                type: true,
                dueDate: true,
              },
            },
          },
        }),
      ]);

      return {
        teacherInClass: teacherClasses.map(cls => ({
          id: cls.id,
          name: cls.name,
          section: cls.section,
          subject: cls.subject,
          dueToday: cls.assignments,
          assignments: cls.assignments,
          color: cls.color,
        })),
        studentInClass: studentClasses.map(cls => ({
          id: cls.id,
          name: cls.name,
          section: cls.section,
          subject: cls.subject,
          dueToday: cls.assignments,
          assignments: cls.assignments,
          color: cls.color,
        })),
      };
    }),
  get: protectedProcedure
    .input(z.object({
      classId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const isTeacher = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: { id: ctx.user?.id },
          },
        },
      });

      const classData = await prisma.class.findUnique({
        where: {
          id: classId,
        },
        include: {
          teachers: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                  profilePictureThumbnail: true,
                }
              }
            },
          },
          students: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                  profilePictureThumbnail: true,
                },
              },
            },
          },
          announcements: {
            orderBy: {
              createdAt: 'desc',
            },
            select: {
              id: true,
              remarks: true,
              createdAt: true,
              modifiedAt: true,
              teacher: {
                select: {
                  id: true,
                  username: true,
                  profile: {
                    select: {
                      displayName: true,
                      profilePicture: true,
                      profilePictureThumbnail: true,
                    },
                  },
                },
              },
            },
          },
          assignments: {
            ...(!isTeacher && {
              where: {OR: [
                {
                  assignedTo: {
                    some: {
                      id: ctx.user?.id,
                    },
                  },
                },
                {
                  assignedTo: {
                    none: {},
                  },
                },
              ],}
            }),
            select: {
              type: true,
              id: true,
              title: true,
              dueDate: true,
              createdAt: true,
              weight: true,
              order: true,
              graded: true,
              maxGrade: true,
              instructions: true,
              inProgress: true,
              template: false,
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
                ...(!isTeacher && {
                  where: {
                    studentId: ctx.user?.id,
                  },
                }),
                select: {
                  studentId: true,
                  id: true,
                  submitted: true,
                  gradeReceived: true,
                  rubricState: true,
                  teacherComments: true,
                  returned: true,
                  submittedAt: true,
                },
              },
            },
          },
        },
      });


      if (!classData) {
        throw new Error('Class not found');
      }
      
      const formattedClassData = {
        ...classData,
        assignments: classData.assignments.map(assignment => ({
          ...assignment,
          late: assignment.dueDate < new Date(),
          submitted: assignment.submissions.find(submission => submission.studentId === ctx.user?.id)?.submitted,
          returned: assignment.submissions.find(submission => submission.studentId === ctx.user?.id)?.returned,
        })),
      }

      const sections = await prisma.section.findMany({
        where: {
          classId: classId,
        },
      });

      return {
        class: {
          ...formattedClassData,
          sections,
        },
      };
    }),
  update: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      name: z.string().optional(),
      section: z.string().optional(),
      subject: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, ...updateData } = input;
      
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
        }
      });

      return {
        updatedClass,
      }
    }),
  create: protectedProcedure
    .input(z.object({
      students: z.array(z.string()).optional(),
      teachers: z.array(z.string()).optional(),
      name: z.string(),
      section: z.string(),
      subject: z.string(),
      color: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { students, teachers, name, section, subject, color } = input;
      
      if (teachers && teachers.length > 0 && students && students.length > 0) {
        const newClass = await prisma.class.create({
          data: {
            name,
            section,
            subject,
            color,
            teachers: {
              connect: teachers.map(teacher => ({ id: teacher })),
            },
            students: {
              connect: students.map(student => ({ id: student })),
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
          color,
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
    .input(z.object({
      classId: z.string(),
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify user is the teacher of this class
      const classToDelete = await prisma.class.findFirst({
        where: {
          id: input.id,
        },
      });

      if (!classToDelete) {
        throw new Error("Class not found or you don't have permission to delete it");
      }

      await prisma.class.delete({
        where: {
          id: input.id,
        },
      });

      return {
        deletedClass: {
          id: input.id,
        }
      }
    }),
  addStudent: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      studentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, studentId } = input;

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
        }
      });

      return {
        updatedClass,
        newStudent: student,
      }
    }),
  changeRole: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      userId: z.string(),
      type: z.enum(['teacher', 'student']),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, userId, type } = input;

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
          [type === 'teacher' ? 'teachers' : 'students']: {
            connect: { id: userId },
          },
          [type === 'teacher' ? 'students' : 'teachers']: {
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
    .input(z.object({
      classId: z.string(),
      userId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, userId } = input;

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
  leaveClass: protectedProcedure
    .input(z.object({
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId } = input;
      const userId = ctx.user?.id;

      if (!userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        });
      }

      const classData = await prisma.class.findFirst({
        where: {
          id: classId,
          students: {
            some: { id: userId },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Class not found or you are not a student in this class',
        });
      }

      await prisma.class.update({
        where: { id: classId },
        data: {
          students: {
            disconnect: { id: userId },
          },
        },
      });

      return {
        success: true,
        leftClassId: classId,
      };
    }),
  join: protectedProcedure
    .input(z.object({
      classCode: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classCode } = input;

      // Case-insensitive search for invite code
      const session = await prisma.session.findFirst({
        where: {
          id: {
            equals: classCode,
            mode: 'insensitive',
          },
        },
      });

      if (!session || !session.classId) {
        throw new Error("Class not found");
      }

      if (session.expiresAt && session.expiresAt < new Date()) {
        throw new Error("Session expired");
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
      }
    }),
  getInviteCode: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
    }))
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
            expiresAt: new Date(Date.now() +  24 * 60 * 60 * 1000), // 24 hours from now
          }
        });
        return {
          code: newSession.id,
        }
      }

      return {
        code: session?.id,
      };
    }),
  createInviteCode: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId } = input;

      await prisma.session.deleteMany({
        where: {
          classId,
        },
      });

      // Create a new session for the invite code
      const session = await prisma.session.create({
        data: {
          id: generateInviteCode(),
          classId,
          expiresAt: new Date(Date.now() +  24 * 60 * 60 * 1000), // 24 hours from now
        }
      });

      return {
        code: session.id,
      };
    }),
  getGrades: protectedClassMemberProcedure
    .input(z.object({
      classId: z.string(),
      userId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { classId, userId } = input;

      const isTeacher = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: { id: ctx.user?.id }
          }
        }
      });
      // If student, only allow viewing their own grades
      if (ctx.user?.id !== userId && !isTeacher) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You can only view your own grades',
        });
      }

      const grades = await prisma.submission.findMany({
        where: {
          studentId: userId,
          assignment: {
            classId: classId,
            graded: true
          }
        },
        include: {
          assignment: {
            select: {
              id: true,
              title: true,
              maxGrade: true,
              weight: true,
              markSchemeId: true,
              markScheme: {
                select: {
                  structured: true,
                }
              },
              gradingBoundaryId: true,
              gradingBoundary: {
                select: {
                  structured: true,
                }
              },
            }
          },
        }
      });

      return {
        grades,
      };
    }),
  updateGrade: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      assignmentId: z.string(),
      submissionId: z.string(),
      gradeReceived: z.number().nullable(),
    }))
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
            }
        }
      }
      });

      return updatedSubmission;
    }),
    getEvents: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const { classId } = input;

        const events = await prisma.event.findMany({
          where: {
            class: {
              id: classId,
            }
          },
          select: {
            name: true,
            startTime: true,
            endTime: true,
          }
        });

        return events;
      }),
    listMarkSchemes: protectedClassMemberProcedure
      .input(z.object({
        classId: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const { classId } = input;

        const markSchemes = await prisma.markScheme.findMany({
          where: {
            class: {
              id: classId,
            },
          },
        });

        return markSchemes;
      }),
    createMarkScheme: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        structure: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, structure } = input;

        const validatedStructure = structure.replace(/\\n/g, '\n');

        const markScheme = await prisma.markScheme.create({
          data: {
            class: {
              connect: {
                id: classId,
              },
            },
            structured: validatedStructure,
          },
        });

        return markScheme;
      }),
    updateMarkScheme: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        markSchemeId: z.string(),
        structure: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, markSchemeId, structure } = input;

        const validatedStructure = structure.replace(/\\n/g, '\n');

        const markScheme = await prisma.markScheme.update({
          where: { id: markSchemeId },
          data: {
            class: {
              connect: {
                id: classId,
              },
            },
            structured: validatedStructure,
          },
        });

        return markScheme;
      }),
    deleteMarkScheme: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        markSchemeId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, markSchemeId } = input;

        const markScheme = await prisma.markScheme.delete({
          where: { id: markSchemeId },
        });

        return markScheme;
      }),
    listGradingBoundaries: protectedClassMemberProcedure
      .input(z.object({
        classId: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const { classId } = input;

        const gradingBoundaries = await prisma.gradingBoundary.findMany({
          where: {
            class: {
              id: classId,
            },
          },
        });

        return gradingBoundaries;
      }),
    createGradingBoundary: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        structure: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, structure } = input;

        const validatedStructure = structure.replace(/\\n/g, '\n');

        const gradingBoundary = await prisma.gradingBoundary.create({
          data: {
            class: {
              connect: {
                id: classId,
              },
            },
            structured: validatedStructure,
          },
        });

        return gradingBoundary;
      }),
    updateGradingBoundary: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        gradingBoundaryId: z.string(),
        structure: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, gradingBoundaryId, structure } = input;

        const validatedStructure = structure.replace(/\\n/g, '\n');

        const gradingBoundary = await prisma.gradingBoundary.update({
          where: { id: gradingBoundaryId },
          data: {
            class: {
              connect: {
                id: classId,
              },
            },
            structured: validatedStructure,
          },
        });

        return gradingBoundary;
      }),
    deleteGradingBoundary: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        gradingBoundaryId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, gradingBoundaryId } = input;

        const gradingBoundary = await prisma.gradingBoundary.delete({
          where: { id: gradingBoundaryId },
        });

        return gradingBoundary;
      }),
      getSyllabus: protectedClassMemberProcedure
      .input(z.object({
        classId: z.string(),
      }))
      .query(async ({input}) => {
        const {classId} = input;

        const syllabus = (await prisma.class.findUnique({
          where: {
            id: classId,
          },
        }))?.syllabus;

        const markSchemes = await prisma.markScheme.findMany({
          where: {
            classId,
          }
        });

        const gradingBoundaries = await prisma.gradingBoundary.findMany({
          where: {
            classId,
          }
        });

        return {syllabus, gradingBoundaries, markSchemes};
      }),
    updateSyllabus: protectedTeacherProcedure
      .input(z.object({
          classId: z.string(),
          contents: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { contents, classId } = input;

        if (!contents) throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Missing key contents",
        });

        const updated = await prisma.class.update({
          where: {
            id: classId
          },
          data: {
            syllabus: contents,
          }
        });

        return updated;
      }),
    // Lab Management Endpoints (Assignment-based)
    listLabDrafts: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const { classId } = input;

        const labDrafts = await prisma.assignment.findMany({
          where: {
            classId: classId,
            teacherId: ctx.user?.id,
            inProgress: true,
          },
          orderBy: {
            modifiedAt: 'desc',
          },
        });

        return labDrafts;
      }),
    createLabDraft: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        title: z.string(),
        type: z.enum(['LAB', 'HOMEWORK', 'QUIZ', 'TEST', 'PROJECT', 'ESSAY', 'DISCUSSION', 'PRESENTATION', 'OTHER']),
        instructions: z.string(),
        dueDate: z.date().optional(),
        maxGrade: z.number().optional(),
        weight: z.number().optional(),
        graded: z.boolean().optional(),
        sectionId: z.string().optional(),
        markSchemeId: z.string().optional(),
        gradingBoundaryId: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, ...draftData } = input;

        const labDraft = await prisma.assignment.create({
          data: {
            classId: classId,
            teacherId: ctx.user?.id!,
            inProgress: true,
            graded: draftData.graded ?? false,
            maxGrade: draftData.maxGrade ?? 0,
            weight: draftData.weight ?? 1,
            dueDate: draftData.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 1 week from now
            title: draftData.title,
            instructions: draftData.instructions,
            type: draftData.type,
            ...(draftData.sectionId && { sectionId: draftData.sectionId }),
            ...(draftData.markSchemeId && { markSchemeId: draftData.markSchemeId }),
            ...(draftData.gradingBoundaryId && { gradingBoundaryId: draftData.gradingBoundaryId }),
          },
        });

        return labDraft;
      }),
    updateLabDraft: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        draftId: z.string(),
        title: z.string().optional(),
        instructions: z.string().optional(),
        dueDate: z.date().optional(),
        maxGrade: z.number().optional(),
        weight: z.number().optional(),
        graded: z.boolean().optional(),
        sectionId: z.string().optional(),
        markSchemeId: z.string().optional(),
        gradingBoundaryId: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, draftId, ...updateData } = input;

        const labDraft = await prisma.assignment.update({
          where: {
            id: draftId,
            classId: classId,
            teacherId: ctx.user?.id!,
            inProgress: true,
          },
          data: {
            ...(updateData.title && { title: updateData.title }),
            ...(updateData.instructions && { instructions: updateData.instructions }),
            ...(updateData.dueDate && { dueDate: updateData.dueDate }),
            ...(updateData.maxGrade !== undefined && { maxGrade: updateData.maxGrade }),
            ...(updateData.weight !== undefined && { weight: updateData.weight }),
            ...(updateData.graded !== undefined && { graded: updateData.graded }),
            ...(updateData.sectionId !== undefined && { sectionId: updateData.sectionId }),
            ...(updateData.markSchemeId !== undefined && { markSchemeId: updateData.markSchemeId }),
            ...(updateData.gradingBoundaryId !== undefined && { gradingBoundaryId: updateData.gradingBoundaryId }),
            modifiedAt: new Date(),
          },
        });

        return labDraft;
      }),
    deleteLabDraft: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        draftId: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, draftId } = input;

        const labDraft = await prisma.assignment.delete({
          where: {
            id: draftId,
            classId: classId,
            teacherId: ctx.user?.id!,
            inProgress: true,
          },
        });

        return labDraft;
      }),
    publishLabDraft: protectedTeacherProcedure
      .input(z.object({
        classId: z.string(),
        draftId: z.string(),
        dueDate: z.date().optional(),
        maxGrade: z.number().optional(),
        weight: z.number().optional(),
        graded: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { classId, draftId, ...publishData } = input;

        // Get the lab draft
        const labDraft = await prisma.assignment.findUnique({
          where: {
            id: draftId,
            classId: classId,
            teacherId: ctx.user?.id!,
            inProgress: true,
          },
        });

        if (!labDraft) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Lab draft not found',
          });
        }

        // Publish the draft by updating it to not be in progress
        const publishedAssignment = await prisma.assignment.update({
          where: { id: draftId },
          data: {
            inProgress: false,
            dueDate: publishData.dueDate || labDraft.dueDate,
            maxGrade: publishData.maxGrade || labDraft.maxGrade || 100,
            weight: publishData.weight || labDraft.weight || 1,
            graded: publishData.graded !== undefined ? publishData.graded : true,
            modifiedAt: new Date(),
          },
        });

        return publishedAssignment;
      }),
    getFiles: protectedClassMemberProcedure
      .input(z.object({
        classId: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        const { classId } = input;

        // Get all assignments with their files and submissions
        const assignments = await prisma.assignment.findMany({
          where: {
            classId: classId,
          },
          include: {
            attachments: {
              select: {
                id: true,
                name: true,
                type: true,
                size: true,
                path: true,
                thumbnailId: true,
                uploadedAt: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                  },
                },
              },
            },
            submissions: {
              include: {
                attachments: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    size: true,
                    path: true,
                    thumbnailId: true,
                    uploadedAt: true,
                    user: {
                      select: {
                        id: true,
                        username: true,
                      },
                    },
                  },
                },
                annotations: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    size: true,
                    path: true,
                    thumbnailId: true,
                    uploadedAt: true,
                    user: {
                      select: {
                        id: true,
                        username: true,
                      },
                    },
                  },
                },
                student: {
                  select: {
                    id: true,
                    username: true,
                  },
                },
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
            createdAt: 'desc',
          },
        });

        // Organize files by assignment structure
        const organizedFiles = assignments.map(assignment => ({
          id: assignment.id,
          title: assignment.title,
          teacher: assignment.teacher,
          teacherAttachments: assignment.attachments,
          students: assignment.submissions.map(submission => ({
            id: submission.student.id,
            username: submission.student.username,
            attachments: submission.attachments,
            annotations: submission.annotations,
          })),
        }));

        return organizedFiles;
      }),
});
import { TRPCError } from "@trpc/server";
import redis from "src/lib/redis";
import { z } from "zod";
import { uploadFiles, type UploadedFile } from "../lib/fileUpload";
import { deleteFile } from "../lib/googleCloudStorage";
import { prisma } from "../lib/prisma";
import {
  createTRPCRouter,
  protectedClassMemberProcedure,
  protectedProcedure,
  protectedTeacherProcedure,
} from "../trpc";

const fileSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number(),
  data: z.string(), // base64 encoded file data
});

const createAssignmentSchema = z.object({
  classId: z.string(),
  title: z.string(),
  instructions: z.string(),
  dueDate: z.string(),
  files: z.array(fileSchema).optional(),
  maxGrade: z.number().optional(),
  graded: z.boolean().optional(),
  weight: z.number().optional(),
  sectionId: z.string().optional(),
  type: z
    .enum([
      "HOMEWORK",
      "QUIZ",
      "TEST",
      "PROJECT",
      "ESSAY",
      "DISCUSSION",
      "PRESENTATION",
      "LAB",
      "OTHER",
    ])
    .optional(),
  markSchemeId: z.string().optional(),
  gradingBoundaryId: z.string().optional(),
});

const updateAssignmentSchema = z.object({
  classId: z.string(),
  id: z.string(),
  title: z.string().optional(),
  instructions: z.string().optional(),
  dueDate: z.string().optional(),
  files: z.array(fileSchema).optional(),
  removedAttachments: z.array(z.string()).optional(),
  maxGrade: z.number().optional(),
  graded: z.boolean().optional(),
  weight: z.number().optional(),
  sectionId: z.string().nullable().optional(),
  type: z
    .enum([
      "HOMEWORK",
      "QUIZ",
      "TEST",
      "PROJECT",
      "ESSAY",
      "DISCUSSION",
      "PRESENTATION",
      "LAB",
      "OTHER",
    ])
    .optional(),
});

const deleteAssignmentSchema = z.object({
  id: z.string(),
  classId: z.string(),
});

const getAssignmentSchema = z.object({
  id: z.string(),
  classId: z.string(),
});

const submissionSchema = z.object({
  assignmentId: z.string(),
  classId: z.string(),
  submissionId: z.string(),
  submit: z.boolean().optional(),
  newAttachments: z.array(fileSchema).optional(),
  removedAttachments: z.array(z.string()).optional(),
});

const updateSubmissionSchema = z.object({
  assignmentId: z.string(),
  classId: z.string(),
  submissionId: z.string(),
  return: z.boolean().optional(),
  gradeReceived: z.number().nullable().optional(),
  newAttachments: z.array(fileSchema).optional(),
  removedAttachments: z.array(z.string()).optional(),
  rubricGrades: z
    .array(
      z.object({
        criteriaId: z.string(),
        selectedLevelId: z.string(),
        points: z.number(),
        comments: z.string(),
      })
    )
    .optional(),
});

export const assignmentRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createAssignmentSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        classId,
        title,
        instructions,
        dueDate,
        files,
        maxGrade,
        graded,
        weight,
        sectionId,
        type,
        markSchemeId,
        gradingBoundaryId,
      } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const cacheKey = `assignment:${ctx.user.id}:${classId}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${classId}`);

      // Get all students in the class
      const classData = await prisma.class.findUnique({
        where: { id: classId },
        include: {
          students: {
            select: { id: true },
          },
        },
      });

      if (!classData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Class not found",
        });
      }

      if (!markSchemeId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "markSchemeId is required",
        });
      }

      const rubric = await prisma.markScheme.findUnique({
        where: { id: markSchemeId },
        select: {
          structured: true,
        },
      });

      const parsedRubric = JSON.parse(rubric?.structured || "{}");

      // Calculate max grade from rubric criteria levels
      const computedMaxGrade = parsedRubric.criteria.reduce(
        (acc: number, criterion: any) => {
          const maxPoints = Math.max(
            ...criterion.levels.map((level: any) => level.points)
          );
          return acc + maxPoints;
        },
        0
      );

      // Create assignment with submissions for all students
      const assignment = await prisma.assignment.create({
        data: {
          title,
          instructions,
          dueDate: new Date(dueDate),
          maxGrade: markSchemeId ? computedMaxGrade : maxGrade,
          graded,
          weight,
          type,
          class: {
            connect: { id: classId },
          },
          ...(sectionId && {
            section: {
              connect: { id: sectionId },
            },
          }),
          ...(markSchemeId && {
            markScheme: {
              connect: { id: markSchemeId },
            },
          }),
          ...(gradingBoundaryId && {
            gradingBoundary: {
              connect: { id: gradingBoundaryId },
            },
          }),
          submissions: {
            create: classData.students.map((student) => ({
              student: {
                connect: { id: student.id },
              },
            })),
          },
          teacher: {
            connect: { id: ctx.user.id },
          },
        },
        select: {
          id: true,
          title: true,
          instructions: true,
          dueDate: true,
          maxGrade: true,
          graded: true,
          weight: true,
          type: true,
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
          class: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      // Upload files if provided
      let uploadedFiles: UploadedFile[] = [];
      if (files && files.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(
          files,
          ctx.user.id,
          `class/${classId}/assignment/${assignment.id}`
        );
      }

      // Update assignment with new file attachments
      if (uploadedFiles.length > 0) {
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            attachments: {
              create: uploadedFiles.map((file) => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId },
                  },
                }),
              })),
            },
          },
        });
      }

      return assignment;
    }),
  createAssignmentComment: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        comment: z.string().min(1, "Comment cannot be empty"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { assignmentId, comment } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Check if assignment exists
      const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, classId: true },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      // Create comment
      const newComment = await prisma.assignmentComment.create({
        data: {
          comment,
          assignment: { connect: { id: assignmentId } },
          user: { connect: { id: ctx.user.id } },
        },
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
      });

      // Clear cache for this assignment
      await redis.del(`classes:${assignment.classId}`);

      return newComment;
    }),
  getComments: protectedProcedure
    .input(z.object({ assignmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const comments = await prisma.assignmentComment.findMany({
        where: { assignmentId: input.assignmentId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return comments;
    }),
  updateAssignmentComment: protectedProcedure
    .input(
      z.object({
        id: z.string(), // comment ID
        comment: z.string().min(1, "Comment cannot be empty"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, comment } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Find the comment first
      const existingComment = await prisma.assignmentComment.findUnique({
        where: { id },
        include: {
          user: true,
        },
      });

      if (!existingComment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Comment not found",
        });
      }

      // Ensure the logged-in user is the owner of the comment
      if (existingComment.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only edit your own comments",
        });
      }

      // Update the comment
      const updatedComment = await prisma.assignmentComment.update({
        where: { id },
        data: {
          comment,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return updatedComment;
    }),
  deleteAssignmentComment: protectedProcedure
    .input(
      z.object({
        commentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure the comment exists
      const comment = await prisma.assignmentComment.findUnique({
        where: { id: input.commentId },
      });

      if (!comment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Comment not found",
        });
      }

      // Delete comment
      const deletedComment = await prisma.assignmentComment.delete({
        where: { id: input.commentId },
      });

      return deletedComment;
    }),
  update: protectedProcedure
    .input(updateAssignmentSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        id,
        title,
        instructions,
        dueDate,
        files,
        maxGrade,
        graded,
        weight,
        sectionId,
        type,
      } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Get the assignment with current attachments
      const assignment = await prisma.assignment.findFirst({
        where: {
          id,
          teacherId: ctx.user.id,
        },
        include: {
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
              thumbnail: {
                select: {
                  path: true,
                },
              },
            },
          },
          class: {
            select: {
              id: true,
              name: true,
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

      // Upload new files if provided
      let uploadedFiles: UploadedFile[] = [];
      if (files && files.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(
          files,
          ctx.user.id,
          `class/${assignment.classId}/assignment/${id}`
        );
      }

      // Update assignment
      const updatedAssignment = await prisma.assignment.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(instructions && { instructions }),
          ...(dueDate && { dueDate: new Date(dueDate) }),
          ...(maxGrade && { maxGrade }),
          ...(graded !== undefined && { graded }),
          ...(weight && { weight }),
          ...(type && { type }),
          ...(sectionId !== undefined && {
            section: sectionId
              ? {
                  connect: { id: sectionId },
                }
              : {
                  disconnect: true,
                },
          }),
          ...(uploadedFiles.length > 0 && {
            attachments: {
              create: uploadedFiles.map((file) => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId },
                  },
                }),
              })),
            },
          }),
          ...(input.removedAttachments &&
            input.removedAttachments.length > 0 && {
              attachments: {
                deleteMany: {
                  id: { in: input.removedAttachments },
                },
              },
            }),
        },
        select: {
          id: true,
          title: true,
          instructions: true,
          dueDate: true,
          maxGrade: true,
          graded: true,
          weight: true,
          type: true,
          createdAt: true,
          submissions: {
            select: {
              student: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
              thumbnail: true,
            },
          },
          section: true,
          teacher: true,
          class: true,
        },
      });

      if (assignment.markSchemeId) {
        const rubric = await prisma.markScheme.findUnique({
          where: { id: assignment.markSchemeId },
          select: {
            structured: true,
          },
        });
        const parsedRubric = JSON.parse(rubric?.structured || "{}");
        const computedMaxGrade = parsedRubric.criteria.reduce(
          (acc: number, criterion: any) => {
            const maxPoints = Math.max(
              ...criterion.levels.map((level: any) => level.points)
            );
            return acc + maxPoints;
          },
          0
        );

        await prisma.assignment.update({
          where: { id },
          data: {
            maxGrade: computedMaxGrade,
          },
        });
      }

      // invalidate cache for the specific assignment
      const cacheKey = `assignment:${ctx.user.id}:${assignment?.classId}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${assignment?.classId}`);

      return updatedAssignment;
    }),

  delete: protectedProcedure
    .input(deleteAssignmentSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, classId } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Get the assignment with all related files
      const assignment = await prisma.assignment.findFirst({
        where: {
          id,
          teacherId: ctx.user.id,
        },
        include: {
          attachments: {
            include: {
              thumbnail: true,
            },
          },
          submissions: {
            include: {
              attachments: {
                include: {
                  thumbnail: true,
                },
              },
              annotations: {
                include: {
                  thumbnail: true,
                },
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

      // Delete all files from storage
      const filesToDelete = [
        ...assignment.attachments,
        ...assignment.submissions.flatMap((sub) => [
          ...sub.attachments,
          ...sub.annotations,
        ]),
      ];

      // Delete files from storage
      await Promise.all(
        filesToDelete.map(async (file) => {
          try {
            // Delete the main file
            await deleteFile(file.path);

            // Delete thumbnail if it exists
            if (file.thumbnail) {
              await deleteFile(file.thumbnail.path);
            }
          } catch (error) {
            console.warn(`Failed to delete file ${file.path}:`, error);
          }
        })
      );

      // Delete the assignment (this will cascade delete all related records)
      await prisma.assignment.delete({
        where: { id },
      });

      // invalidate cache for the specific assignment
      const cacheKey = `assignment:${ctx.user.id}:${assignment?.classId}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${assignment?.classId}`);

      return {
        id,
      };
    }),

  get: protectedProcedure
    .input(getAssignmentSchema)
    .query(async ({ ctx, input }) => {
      const { id, classId } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Try getting data from Redis
      // invalidate cache for the specific assignment
      const cacheKey = `assignment:${ctx.user.id}:${classId}`;
      const cached = await redis.get(cacheKey);
      console.log("class Cache hit:", cached);
      if (cached) {
        return JSON.parse(cached);
      }

      const assignment = await prisma.assignment.findUnique({
        where: {
          id,
          // classId,
        },
        include: {
          submissions: {
            select: {
              student: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              path: true,
              thumbnailId: true,
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
          class: {
            select: {
              id: true,
              name: true,
            },
          },
          eventAttached: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
              location: true,
              remarks: true,
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
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      const sections = await prisma.section.findMany({
        where: {
          classId: assignment.classId,
        },
        select: {
          id: true,
          name: true,
        },
      });

      const data = { ...assignment, sections };

      // Store in Redis (set cache for 10 mins)
      await redis.set(cacheKey, JSON.stringify(data), {
        EX: 600, // 600 seconds = 10 minutes
      });

      return data;
    }),

  getSubmission: protectedClassMemberProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { assignmentId } = input;

      const submission = await prisma.submission.findFirst({
        where: {
          assignmentId,
          studentId: ctx.user.id,
        },
        include: {
          attachments: true,
          student: {
            select: {
              id: true,
              username: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
          annotations: true,
        },
      });

      if (!submission) {
        // Create a new submission if it doesn't exist
        return await prisma.submission.create({
          data: {
            assignment: {
              connect: { id: assignmentId },
            },
            student: {
              connect: { id: ctx.user.id },
            },
          },
          include: {
            attachments: true,
            annotations: true,
            student: {
              select: {
                id: true,
                username: true,
              },
            },
            assignment: {
              include: {
                class: true,
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
              },
            },
          },
        });
      }

      return {
        ...submission,
        late: submission.assignment.dueDate < new Date(),
      };
    }),

  getSubmissionById: protectedTeacherProcedure
    .input(
      z.object({
        submissionId: z.string(),
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { submissionId, classId } = input;

      const submission = await prisma.submission.findFirst({
        where: {
          id: submissionId,
          assignment: {
            classId,
            class: {
              teachers: {
                some: {
                  id: ctx.user.id,
                },
              },
            },
          },
        },
        include: {
          attachments: true,
          annotations: true,
          student: {
            select: {
              id: true,
              username: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
        },
      });

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      return {
        ...submission,
        late: submission.assignment.dueDate < new Date(),
      };
    }),

  updateSubmission: protectedClassMemberProcedure
    .input(submissionSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { submissionId, submit, newAttachments, removedAttachments } =
        input;

      const submission = await prisma.submission.findFirst({
        where: {
          id: submissionId,
          OR: [
            {
              student: {
                id: ctx.user.id,
              },
            },
            {
              assignment: {
                class: {
                  teachers: {
                    some: {
                      id: ctx.user.id,
                    },
                  },
                },
              },
            },
          ],
        },
        include: {
          attachments: {
            include: {
              thumbnail: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
        },
      });

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      if (submit !== undefined) {
        // Toggle submission status
        return await prisma.submission.update({
          where: { id: submission.id },
          data: {
            submitted: !submission.submitted,
            submittedAt: new Date(),
          },
          include: {
            attachments: true,
            student: {
              select: {
                id: true,
                username: true,
              },
            },
            assignment: {
              include: {
                class: true,
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
              },
            },
          },
        });
      }

      let uploadedFiles: UploadedFile[] = [];
      if (newAttachments && newAttachments.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(
          newAttachments,
          ctx.user.id,
          `class/${submission.assignment.classId}/assignment/${submission.assignmentId}/submission/${submission.id}`
        );
      }

      // Update submission with new file attachments
      if (uploadedFiles.length > 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            attachments: {
              create: uploadedFiles.map((file) => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId },
                  },
                }),
              })),
            },
          },
        });
      }

      // Delete removed attachments if any
      if (removedAttachments && removedAttachments.length > 0) {
        const filesToDelete = submission.attachments.filter((file) =>
          removedAttachments.includes(file.id)
        );

        // Delete files from storage
        await Promise.all(
          filesToDelete.map(async (file) => {
            try {
              // Delete the main file
              await deleteFile(file.path);

              // Delete thumbnail if it exists
              if (file.thumbnail?.path) {
                await deleteFile(file.thumbnail.path);
              }
            } catch (error) {
              console.warn(`Failed to delete file ${file.path}:`, error);
            }
          })
        );
      }

      // invalidate cache for the specific assignment
      const cacheKey = `assignment:${ctx.user.id}:${input?.classId}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${input?.classId}`);

      // Update submission with attachments
      return await prisma.submission.update({
        where: { id: submission.id },
        data: {
          ...(removedAttachments &&
            removedAttachments.length > 0 && {
              attachments: {
                deleteMany: {
                  id: { in: removedAttachments },
                },
              },
            }),
        },
        include: {
          attachments: {
            include: {
              thumbnail: true,
            },
          },
          student: {
            select: {
              id: true,
              username: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
        },
      });
    }),

  getSubmissions: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { assignmentId } = input;

      const submissions = await prisma.submission.findMany({
        where: {
          assignment: {
            id: assignmentId,
            class: {
              teachers: {
                some: { id: ctx.user.id },
              },
            },
          },
        },
        include: {
          attachments: {
            include: {
              thumbnail: true,
            },
          },
          student: {
            select: {
              id: true,
              username: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
        },
      });

      return submissions.map((submission) => ({
        ...submission,
        late: submission.assignment.dueDate < new Date(),
      }));
    }),

  updateSubmissionAsTeacher: protectedTeacherProcedure
    .input(updateSubmissionSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const {
        submissionId,
        return: returnSubmission,
        gradeReceived,
        newAttachments,
        removedAttachments,
        rubricGrades,
      } = input;

      const submission = await prisma.submission.findFirst({
        where: {
          id: submissionId,
          assignment: {
            class: {
              teachers: {
                some: { id: ctx.user.id },
              },
            },
          },
        },
        include: {
          attachments: {
            include: {
              thumbnail: true,
            },
          },
          annotations: {
            include: {
              thumbnail: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
        },
      });

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found",
        });
      }

      if (returnSubmission !== undefined) {
        // Toggle return status
        return await prisma.submission.update({
          where: { id: submissionId },
          data: {
            returned: !submission.returned,
          },
          include: {
            attachments: true,
            student: {
              select: {
                id: true,
                username: true,
              },
            },
            assignment: {
              include: {
                class: true,
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
              },
            },
          },
        });
      }

      let uploadedFiles: UploadedFile[] = [];
      if (newAttachments && newAttachments.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(
          newAttachments,
          ctx.user.id,
          `class/${submission.assignment.classId}/assignment/${submission.assignmentId}/submission/${submission.id}/annotations`
        );
      }

      // Update submission with new file attachments
      if (uploadedFiles.length > 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            annotations: {
              create: uploadedFiles.map((file) => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId },
                  },
                }),
              })),
            },
          },
        });
      }

      // Delete removed attachments if any
      if (removedAttachments && removedAttachments.length > 0) {
        const filesToDelete = submission.annotations.filter((file) =>
          removedAttachments.includes(file.id)
        );

        // Delete files from storage
        await Promise.all(
          filesToDelete.map(async (file) => {
            try {
              // Delete the main file
              await deleteFile(file.path);

              // Delete thumbnail if it exists
              if (file.thumbnail?.path) {
                await deleteFile(file.thumbnail.path);
              }
            } catch (error) {
              console.warn(`Failed to delete file ${file.path}:`, error);
            }
          })
        );
      }

      // invalidate cache for the specific assignment
      const cacheKey = `assignment:${ctx.user.id}:${input?.classId}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${input?.classId}`);

      // Update submission with grade and attachments
      return await prisma.submission.update({
        where: { id: submissionId },
        data: {
          ...(gradeReceived !== undefined && { gradeReceived }),
          ...(rubricGrades && { rubricState: JSON.stringify(rubricGrades) }),
          ...(removedAttachments &&
            removedAttachments.length > 0 && {
              annotations: {
                deleteMany: {
                  id: { in: removedAttachments },
                },
              },
            }),
        },
        include: {
          attachments: {
            include: {
              thumbnail: true,
            },
          },
          annotations: {
            include: {
              thumbnail: true,
            },
          },
          student: {
            select: {
              id: true,
              username: true,
            },
          },
          assignment: {
            include: {
              class: true,
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
            },
          },
        },
      });
    }),

  attachToEvent: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        eventId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { assignmentId, eventId } = input;

      // Check if assignment exists and user is a teacher of the class
      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          class: {
            teachers: {
              some: { id: ctx.user.id },
            },
          },
        },
        include: {
          class: true,
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found or you are not authorized",
        });
      }

      // Check if event exists and belongs to the same class
      const event = await prisma.event.findFirst({
        where: {
          id: eventId,
          classId: assignment.classId,
        },
      });

      if (!event) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found or does not belong to the same class",
        });
      }

      // Attach assignment to event
      const updatedAssignment = await prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          eventAttached: {
            connect: { id: eventId },
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
          eventAttached: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
            },
          },
        },
      });

      // invalidate cache for the specific assignment
      const cacheKey = `assignment:${ctx.user.id}:${input?.classId}`;
      await redis.del(cacheKey);
      await redis.del(`classes:${input?.classId}`);

      return { assignment: updatedAssignment };
    }),

  detachEvent: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { assignmentId } = input;

      // Check if assignment exists and user is a teacher of the class
      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          class: {
            teachers: {
              some: { id: ctx.user.id },
            },
          },
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found or you are not authorized",
        });
      }

      // Detach assignment from event
      const updatedAssignment = await prisma.assignment.update({
        where: { id: assignmentId },
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
          eventAttached: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
            },
          },
        },
      });

      return { assignment: updatedAssignment };
    }),

  getAvailableEvents: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const { assignmentId } = input;

      // Get the assignment to find the class
      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          class: {
            teachers: {
              some: { id: ctx.user.id },
            },
          },
        },
        select: { classId: true },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found or you are not authorized",
        });
      }

      // Get all events for the class that don't already have this assignment attached
      const events = await prisma.event.findMany({
        where: {
          classId: assignment.classId,
          assignmentsAttached: {
            none: {
              id: assignmentId,
            },
          },
        },
        select: {
          id: true,
          name: true,
          startTime: true,
          endTime: true,
          location: true,
          remarks: true,
        },
        orderBy: {
          startTime: "asc",
        },
      });

      return { events };
    }),

  dueToday: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User must be authenticated",
      });
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0); // beginning of today

    const end = new Date();
    end.setHours(23, 59, 59, 999); // end of today

    const assignments = await prisma.assignment.findMany({
      where: {
        // dueDate: {
        //   equals: new Date(),
        // },
        dueDate: {
          gte: start,
          lte: end,
        },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        type: true,
        graded: true,
        maxGrade: true,
        class: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return assignments.map((assignment) => ({
      ...assignment,
      dueDate: assignment.dueDate.toISOString(),
    }));
  }),
  attachMarkScheme: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        markSchemeId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { assignmentId, markSchemeId } = input;

      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      // If markSchemeId is provided, verify it exists
      if (markSchemeId) {
        const markScheme = await prisma.markScheme.findFirst({
          where: {
            id: markSchemeId,
          },
        });

        if (!markScheme) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Mark scheme not found",
          });
        }
      }

      const updatedAssignment = await prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          markScheme: markSchemeId
            ? {
                connect: { id: markSchemeId },
              }
            : {
                disconnect: true,
              },
        },
        include: {
          attachments: true,
          section: true,
          teacher: true,
          eventAttached: true,
          markScheme: true,
        },
      });

      return updatedAssignment;
    }),
  detachMarkScheme: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { assignmentId } = input;

      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      const updatedAssignment = await prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          markScheme: {
            disconnect: true,
          },
        },
        include: {
          attachments: true,
          section: true,
          teacher: true,
          eventAttached: true,
          markScheme: true,
        },
      });

      return updatedAssignment;
    }),

  attachGradingBoundary: protectedTeacherProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        gradingBoundaryId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { assignmentId, gradingBoundaryId } = input;

      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      // If gradingBoundaryId is provided, verify it exists
      if (gradingBoundaryId) {
        const gradingBoundary = await prisma.gradingBoundary.findFirst({
          where: {
            id: gradingBoundaryId,
          },
        });

        if (!gradingBoundary) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Grading boundary not found",
          });
        }
      }

      const updatedAssignment = await prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          gradingBoundary: gradingBoundaryId
            ? {
                connect: { id: gradingBoundaryId },
              }
            : {
                disconnect: true,
              },
        },
        include: {
          attachments: true,
          section: true,
          teacher: true,
          eventAttached: true,
          gradingBoundary: true,
        },
      });

      return updatedAssignment;
    }),
});

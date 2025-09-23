import { z } from "zod";
import { createTRPCRouter, protectedProcedure, protectedClassMemberProcedure, protectedTeacherProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";
import { uploadFiles, type UploadedFile } from "../lib/fileUpload.js";
import { deleteFile } from "../lib/googleCloudStorage.js";

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
  existingFileIds: z.array(z.string()).optional(),
  maxGrade: z.number().optional(),
  graded: z.boolean().optional(),
  weight: z.number().optional(),
  sectionId: z.string().optional(),
  type: z.enum(['HOMEWORK', 'QUIZ', 'TEST', 'PROJECT', 'ESSAY', 'DISCUSSION', 'PRESENTATION', 'LAB', 'OTHER']).optional(),
  markSchemeId: z.string().optional(),
  gradingBoundaryId: z.string().optional(),
  inProgress: z.boolean().optional(),
});

const updateAssignmentSchema = z.object({
  classId: z.string(),
  id: z.string(),
  title: z.string().optional(),
  instructions: z.string().optional(),
  dueDate: z.string().optional(),
  files: z.array(fileSchema).optional(),
  existingFileIds: z.array(z.string()).optional(),
  removedAttachments: z.array(z.string()).optional(),
  maxGrade: z.number().optional(),
  graded: z.boolean().optional(),
  weight: z.number().optional(),
  sectionId: z.string().nullable().optional(),
  type: z.enum(['HOMEWORK', 'QUIZ', 'TEST', 'PROJECT', 'ESSAY', 'DISCUSSION', 'PRESENTATION', 'LAB', 'OTHER']).optional(),
  inProgress: z.boolean().optional(),
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
  existingFileIds: z.array(z.string()).optional(),
  removedAttachments: z.array(z.string()).optional(),
});

const updateSubmissionSchema = z.object({
  assignmentId: z.string(),
  classId: z.string(),
  submissionId: z.string(),
  return: z.boolean().optional(),
  gradeReceived: z.number().nullable().optional(),
  newAttachments: z.array(fileSchema).optional(),
  existingFileIds: z.array(z.string()).optional(),
  removedAttachments: z.array(z.string()).optional(),
  feedback: z.string().optional(),
  rubricGrades: z.array(z.object({
    criteriaId: z.string(),
    selectedLevelId: z.string(),
    points: z.number(),
    comments: z.string(),
  })).optional(),
});

export const assignmentRouter = createTRPCRouter({
  order: protectedTeacherProcedure
    .input(z.object({
      id: z.string(),
      classId: z.string(),
      order: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, order } = input;

      const assignment = await prisma.assignment.update({
        where: { id },
        data: { order },
      });

      return assignment;
    }),

    move: protectedTeacherProcedure
    .input(z.object({
      id: z.string(),
      classId: z.string(),
      targetSectionId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, targetSectionId,  } = input;


      const assignments = await prisma.assignment.findMany({
        where: { sectionId: targetSectionId },
      });

      const stack = assignments.sort((a, b) => (a.order || 0) - (b.order || 0)).map((assignment, index) => ({
        id: assignment.id,
        order: index + 1,
      })).map((assignment) => ({
        where: { id: assignment.id },
        data: { order: assignment.order },
      }));

      await Promise.all(
        stack.map(({ where, data }) =>
          prisma.assignment.update({ where, data })
        )
      );

      const assignment = await prisma.assignment.update({
        where: { id },
        data: { sectionId: targetSectionId, order: 0 },
      });

      return assignment;
    }),

  create: protectedProcedure
    .input(createAssignmentSchema)
    .mutation(async ({ ctx, input }) => {
      const { classId, title, instructions, dueDate, files, existingFileIds, maxGrade, graded, weight, sectionId, type, markSchemeId, gradingBoundaryId, inProgress } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      // Get all students in the class
      const classData = await prisma.class.findUnique({
        where: { id: classId },
        include: {
          students: {
            select: { id: true }
          }
        }
      });

      if (!classData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Class not found",
        });
      }

      let computedMaxGrade = maxGrade;
      if (markSchemeId) {
        const rubric = await prisma.markScheme.findUnique({
          where: { id: markSchemeId },
          select: {
            structured: true,
          }
        });

        const parsedRubric = JSON.parse(rubric?.structured || "{}");

        // Calculate max grade from rubric criteria levels
        computedMaxGrade = parsedRubric.criteria.reduce((acc: number, criterion: any) => {
          const maxPoints = Math.max(...criterion.levels.map((level: any) => level.points));
          return acc + maxPoints;
        }, 0);
      }
      console.log(markSchemeId, gradingBoundaryId);

      // find all assignments in the section it is in (or none) and reorder them
      const assignments = await prisma.assignment.findMany({
        where: {
          classId: classId,
          ...(sectionId && {
            sectionId: sectionId,
          }),
        },
      });

      const stack = assignments.sort((a, b) => (a.order || 0) - (b.order || 0)).map((assignment, index) => ({
        id: assignment.id,
        order: index + 1,
      })).map((assignment) => ({
        where: { id: assignment.id },
        data: { order: assignment.order },
      }));

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
          order: 0,
          inProgress: inProgress || false,
          class: {
            connect: { id: classId }
          },
          ...(sectionId && {
            section: {
              connect: { id: sectionId }
            }
          }),
          ...(markSchemeId && {
            markScheme: {
              connect: { id: markSchemeId }
            }
          }),
          ...(gradingBoundaryId && {
            gradingBoundary: {
              connect: { id: gradingBoundaryId }
            }
          }),
          submissions: {
            create: classData.students.map((student) => ({
              student: {
                connect: { id: student.id }
              }
            }))
          },
          teacher: {
            connect: { id: ctx.user.id }
          }
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
            }
          },
          section: {
            select: {
              id: true,
              name: true
            }
          },
          teacher: {
            select: {
              id: true,
              username: true
            }
          },
          class: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      await Promise.all(
        stack.map(({ where, data }) =>
          prisma.assignment.update({ where, data })
        )
      );

      // Upload files if provided
      let uploadedFiles: UploadedFile[] = [];
      if (files && files.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(files, ctx.user.id);
      }

      // Update assignment with new file attachments
      if (uploadedFiles.length > 0) {
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            attachments: {
              create: uploadedFiles.map(file => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId }
                  }
                })
              }))
            }
          }
        });
      }

      // Connect existing files if provided
      if (existingFileIds && existingFileIds.length > 0) {
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: {
            attachments: {
              connect: existingFileIds.map(fileId => ({ id: fileId }))
            }
          }
        });
      }

      return assignment;
    }),
  update: protectedProcedure
    .input(updateAssignmentSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, title, instructions, dueDate, files, existingFileIds, maxGrade, graded, weight, sectionId, type, inProgress } = input;

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
              path: true,
              size: true,
              thumbnail: {
                select: {
                  path: true
                }
              }
            },
          },
          class: {
            select: {
              id: true,
              name: true
            }
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
        uploadedFiles = await uploadFiles(files, ctx.user.id);
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
          ...(inProgress !== undefined && { inProgress }),
          ...(sectionId !== undefined && {
            section: sectionId ? {
              connect: { id: sectionId }
            } : {
              disconnect: true
            }
          }),
          ...(uploadedFiles.length > 0 && {
            attachments: {
              create: uploadedFiles.map(file => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId }
                  }
                })
              }))
            }
          }),
          ...(existingFileIds && existingFileIds.length > 0 && {
            attachments: {
              connect: existingFileIds.map(fileId => ({ id: fileId }))
            }
          }),
          ...(input.removedAttachments && input.removedAttachments.length > 0 && {
            attachments: {
              deleteMany: {
                id: { in: input.removedAttachments }
              }
            }
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
                  username: true
                }
              }
            }
          },
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
              thumbnail: true,
              size: true,
              path: true,
              uploadedAt: true,
              thumbnailId: true,
            }
          },
          section: true,
          teacher: true,
          class: true
        }
      });


      if (assignment.markSchemeId) {
        const rubric = await prisma.markScheme.findUnique({
          where: { id: assignment.markSchemeId },
          select: {
            structured: true,
          }
        });
        const parsedRubric = JSON.parse(rubric?.structured || "{}");
        const computedMaxGrade = parsedRubric.criteria.reduce((acc: number, criterion: any) => {
          const maxPoints = Math.max(...criterion.levels.map((level: any) => level.points));
          return acc + maxPoints;
        }, 0);

        await prisma.assignment.update({
          where: { id },
          data: {
            maxGrade: computedMaxGrade,
          }
        });
      }


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
              thumbnail: true
            }
          },
          submissions: {
            include: {
              attachments: {
                include: {
                  thumbnail: true
                }
              },
              annotations: {
                include: {
                  thumbnail: true
                }
              }
            }
          }
        }
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
        ...assignment.submissions.flatMap(sub => [...sub.attachments, ...sub.annotations])
      ];

      // Delete files from storage
      await Promise.all(filesToDelete.map(async (file) => {
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
      }));

      // Delete the assignment (this will cascade delete all related records)
      await prisma.assignment.delete({
        where: { id },
      });

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
                  username: true
                }
              }
            }
          },
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
              size: true,
              path: true,
              uploadedAt: true,
              thumbnailId: true,
            }
          },
          section: {
            select: {
              id: true,
              name: true,
            }
          },
          teacher: {
            select: {
              id: true,
              username: true
            }
          },
          class: {
            select: {
              id: true,
              name: true
            }
          },
          eventAttached: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
              location: true,
              remarks: true,
            }
          },
          markScheme: {
            select: {
              id: true,
              structured: true,
            }
          },
          gradingBoundary: {
            select: {
              id: true,
              structured: true,
            }
          }
        }
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

      return { ...assignment, sections };
    }),

  getSubmission: protectedClassMemberProcedure
    .input(z.object({
      assignmentId: z.string(),
      classId: z.string(),
    }))
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
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
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
                  }
                },
                gradingBoundary: {
                  select: {
                    id: true,
                    structured: true,
                  }
                }
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
    .input(z.object({
      submissionId: z.string(),
      classId: z.string(),
    }))
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
                  id: ctx.user.id
                }
              }
            }
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
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
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

      const { submissionId, submit, newAttachments, existingFileIds, removedAttachments } = input;

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
              thumbnail: true
            }
          },
          assignment: {
            include: {
              class: true,
              markScheme: {
                select: {
                  id: true,
                  structured: true,
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
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
                  }
                },
                gradingBoundary: {
                  select: {
                    id: true,
                    structured: true,
                  }
                }
              },
            },
          },
        });
      }

      let uploadedFiles: UploadedFile[] = [];
      if (newAttachments && newAttachments.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(newAttachments, ctx.user.id);
      }

      // Update submission with new file attachments
      if (uploadedFiles.length > 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            attachments: {
              create: uploadedFiles.map(file => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId }
                  }
                })
              }))
            }
          }
        });
      }

      // Connect existing files if provided
      if (existingFileIds && existingFileIds.length > 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            attachments: {
              connect: existingFileIds.map(fileId => ({ id: fileId }))
            }
          }
        });
      }

      // Delete removed attachments if any
      if (removedAttachments && removedAttachments.length > 0) {
        const filesToDelete = submission.attachments.filter((file) =>
          removedAttachments.includes(file.id)
        );

        // Delete files from storage
        await Promise.all(filesToDelete.map(async (file) => {
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
        }));
      }

      // Update submission with attachments
      return await prisma.submission.update({
        where: { id: submission.id },
        data: {
          ...(removedAttachments && removedAttachments.length > 0 && {
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
              thumbnail: true
            }
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
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
            },
          },
        },
      });
    }),

  getSubmissions: protectedTeacherProcedure
    .input(z.object({
      assignmentId: z.string(),
      classId: z.string(),
    }))
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
              thumbnail: true
            }
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
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
            },
          },
        },
      });

      return submissions.map(submission => ({
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

      const { submissionId, return: returnSubmission, gradeReceived, newAttachments, existingFileIds, removedAttachments, rubricGrades, feedback } = input;

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
              thumbnail: true
            }
          },
          annotations: {
            include: {
              thumbnail: true
            }
          },
          assignment: {
            include: {
              class: true,
              markScheme: {
                select: {
                  id: true,
                  structured: true,
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
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
                  }
                },
                gradingBoundary: {
                  select: {
                    id: true,
                    structured: true,
                  }
                }
              },
            },
          },
        });
      }

      let uploadedFiles: UploadedFile[] = [];
      if (newAttachments && newAttachments.length > 0) {
        // Store files in a class and assignment specific directory
        uploadedFiles = await uploadFiles(newAttachments, ctx.user.id);
      }

      // Update submission with new file attachments
      if (uploadedFiles.length > 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            annotations: {
              create: uploadedFiles.map(file => ({
                name: file.name,
                type: file.type,
                size: file.size,
                path: file.path,
                ...(file.thumbnailId && {
                  thumbnail: {
                    connect: { id: file.thumbnailId }
                  }
                })
              }))
            }
          }
        });
      }

      // Connect existing files if provided
      if (existingFileIds && existingFileIds.length > 0) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            annotations: {
              connect: existingFileIds.map(fileId => ({ id: fileId }))
            }
          }
        });
      }

      // Delete removed attachments if any
      if (removedAttachments && removedAttachments.length > 0) {
        const filesToDelete = submission.annotations.filter((file) =>
          removedAttachments.includes(file.id)
        );

        // Delete files from storage
        await Promise.all(filesToDelete.map(async (file) => {
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
        }));
      }

      // Update submission with grade and attachments
      return await prisma.submission.update({
        where: { id: submissionId },
        data: {
          ...(gradeReceived !== undefined && { gradeReceived }),
          ...(rubricGrades && { rubricState: JSON.stringify(rubricGrades) }),
          ...(feedback && { teacherComments: feedback }),
          ...(removedAttachments && removedAttachments.length > 0 && {
            annotations: {
              deleteMany: {
                id: { in: removedAttachments },
              },
            },
          }),
          ...(returnSubmission as unknown as boolean && { returned: returnSubmission }),
        },
        include: {
          attachments: {
            include: {
              thumbnail: true
            }
          },
          annotations: {
            include: {
              thumbnail: true
            }
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
                }
              },
              gradingBoundary: {
                select: {
                  id: true,
                  structured: true,
                }
              }
            },
          },
        },
      });
    }),

  attachToEvent: protectedTeacherProcedure
    .input(z.object({
      assignmentId: z.string(),
      eventId: z.string(),
    }))
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
            connect: { id: eventId }
          }
        },
        include: {
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
            }
          },
          section: {
            select: {
              id: true,
              name: true
            }
          },
          teacher: {
            select: {
              id: true,
              username: true
            }
          },
          eventAttached: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
            }
          }
        }
      });

      return { assignment: updatedAssignment };
    }),

  detachEvent: protectedTeacherProcedure
    .input(z.object({
      assignmentId: z.string(),
    }))
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
            disconnect: true
          }
        },
        include: {
          attachments: {
            select: {
              id: true,
              name: true,
              type: true,
            }
          },
          section: {
            select: {
              id: true,
              name: true
            }
          },
          teacher: {
            select: {
              id: true,
              username: true
            }
          },
          eventAttached: {
            select: {
              id: true,
              name: true,
              startTime: true,
              endTime: true,
            }
          }
        }
      });

      return { assignment: updatedAssignment };
    }),

  getAvailableEvents: protectedTeacherProcedure
    .input(z.object({
      assignmentId: z.string(),
    }))
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
        select: { classId: true }
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
              id: assignmentId
            }
          }
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
          startTime: 'asc'
        }
      });

      return { events };
    }),

  dueToday: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const assignments = await prisma.assignment.findMany({
        where: {
          dueDate: {
            equals: new Date(),
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
            }
          }
        }
      });

      return assignments.map(assignment => ({
        ...assignment,
        dueDate: assignment.dueDate.toISOString(),
      }));
    }),
  attachMarkScheme: protectedTeacherProcedure
    .input(z.object({
      assignmentId: z.string(),
      markSchemeId: z.string().nullable(),
    }))
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
          markScheme: markSchemeId ? {
            connect: { id: markSchemeId },
          } : {
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
    .input(z.object({
      assignmentId: z.string(),
    }))
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
    .input(z.object({
      assignmentId: z.string(),
      gradingBoundaryId: z.string().nullable(),
    }))
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
          gradingBoundary: gradingBoundaryId ? {
            connect: { id: gradingBoundaryId },
          } : {
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
  detachGradingBoundary: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      assignmentId: z.string(),
    }))
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
          gradingBoundary: {
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


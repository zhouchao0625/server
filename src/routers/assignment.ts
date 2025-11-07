import { z } from "zod";
import { createTRPCRouter, protectedProcedure, protectedClassMemberProcedure, protectedTeacherProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";
import { createDirectUploadFiles, type DirectUploadFile, confirmDirectUpload, updateUploadProgress, type UploadedFile } from "../lib/fileUpload.js";
import { deleteFile } from "../lib/googleCloudStorage.js";
import { sendNotifications } from "../lib/notificationHandler.js";
import { logger } from "../utils/logger.js";

// DEPRECATED: This schema is no longer used - files are uploaded directly to GCS
// Use directFileSchema instead

// New schema for direct file uploads (no base64 data)
const directFileSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number(),
  // No data field - for direct file uploads
});

const createAssignmentSchema = z.object({
  classId: z.string(),
  title: z.string(),
  instructions: z.string(),
  dueDate: z.string(),
  files: z.array(directFileSchema).optional(), // Use direct file schema
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
  files: z.array(directFileSchema).optional(), // Use direct file schema
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
  newAttachments: z.array(directFileSchema).optional(), // Use direct file schema
  existingFileIds: z.array(z.string()).optional(),
  removedAttachments: z.array(z.string()).optional(),
});

const updateSubmissionSchema = z.object({
  assignmentId: z.string(),
  classId: z.string(),
  submissionId: z.string(),
  return: z.boolean().optional(),
  gradeReceived: z.number().nullable().optional(),
  newAttachments: z.array(directFileSchema).optional(), // Use direct file schema
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

// New schemas for direct upload functionality
const getAssignmentUploadUrlsSchema = z.object({
  assignmentId: z.string(),
  classId: z.string(),
  files: z.array(directFileSchema),
});

const getSubmissionUploadUrlsSchema = z.object({
  submissionId: z.string(),
  classId: z.string(),
  files: z.array(directFileSchema),
});

const confirmAssignmentUploadSchema = z.object({
  fileId: z.string(),
  uploadSuccess: z.boolean(),
  errorMessage: z.string().optional(),
});

const confirmSubmissionUploadSchema = z.object({
  fileId: z.string(),
  uploadSuccess: z.boolean(),
  errorMessage: z.string().optional(),
});

const getAnnotationUploadUrlsSchema = z.object({
  submissionId: z.string(),
  classId: z.string(),
  files: z.array(directFileSchema),
});

const confirmAnnotationUploadSchema = z.object({
  fileId: z.string(),
  uploadSuccess: z.boolean(),
  errorMessage: z.string().optional(),
});

const updateUploadProgressSchema = z.object({
  fileId: z.string(),
  progress: z.number().min(0).max(100),
});

// Helper function to get unified list of sections and assignments for a class
async function getUnifiedList(tx: any, classId: string) {
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

  // Combine and sort by order
  const unified = [
    ...sections.map((s: any) => ({ id: s.id, order: s.order, type: 'section' as const })),
    ...assignments.map((a: any) => ({ id: a.id, order: a.order, type: 'assignment' as const })),
  ].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  return unified;
}

// Helper function to normalize unified list to 1..n
async function normalizeUnifiedList(tx: any, classId: string, orderedItems: Array<{ id: string; type: 'section' | 'assignment' }>) {
  await Promise.all(
    orderedItems.map((item, index) => {
      if (item.type === 'section') {
        return tx.section.update({ where: { id: item.id }, data: { order: index + 1 } });
      } else {
        return tx.assignment.update({ where: { id: item.id }, data: { order: index + 1 } });
      }
    })
  );
}

export const assignmentRouter = createTRPCRouter({
  // Reorder an assignment within the unified list (sections + assignments)
  reorder: protectedTeacherProcedure
    .input(z.object({
      classId: z.string(),
      movedId: z.string(),
      // One of: place at start/end of unified list, or relative to targetId (can be section or assignment)
      position: z.enum(['start', 'end', 'before', 'after']),
      targetId: z.string().optional(), // Can be a section ID or assignment ID
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, movedId, position, targetId } = input;

      const moved = await prisma.assignment.findFirst({
        where: { id: movedId, classId },
        select: { id: true, classId: true },
      });

      if (!moved) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found' });
      }

      if ((position === 'before' || position === 'after') && !targetId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'targetId required for before/after' });
      }

      const result = await prisma.$transaction(async (tx) => {
        const unified = await getUnifiedList(tx, classId);

        // Find moved item and target in unified list
        const movedIdx = unified.findIndex(item => item.id === movedId && item.type === 'assignment');
        if (movedIdx === -1) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found in unified list' });
        }

        // Build list without moved item
        const withoutMoved = unified.filter(item => !(item.id === movedId && item.type === 'assignment'));

        let next: Array<{ id: string; type: 'section' | 'assignment' }> = [];

        if (position === 'start') {
          next = [{ id: movedId, type: 'assignment' }, ...withoutMoved.map(item => ({ id: item.id, type: item.type }))];
        } else if (position === 'end') {
          next = [...withoutMoved.map(item => ({ id: item.id, type: item.type })), { id: movedId, type: 'assignment' }];
        } else {
          const targetIdx = withoutMoved.findIndex(item => item.id === targetId);
          if (targetIdx === -1) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'targetId not found in unified list' });
          }
          if (position === 'before') {
            next = [
              ...withoutMoved.slice(0, targetIdx).map(item => ({ id: item.id, type: item.type })),
              { id: movedId, type: 'assignment' },
              ...withoutMoved.slice(targetIdx).map(item => ({ id: item.id, type: item.type })),
            ];
          } else {
            next = [
              ...withoutMoved.slice(0, targetIdx + 1).map(item => ({ id: item.id, type: item.type })),
              { id: movedId, type: 'assignment' },
              ...withoutMoved.slice(targetIdx + 1).map(item => ({ id: item.id, type: item.type })),
            ];
          }
        }

        // Normalize to 1..n
        await normalizeUnifiedList(tx, classId, next);

        return tx.assignment.findUnique({ where: { id: movedId } });
      });

      return result;
    }),
  order: protectedTeacherProcedure
    .input(z.object({
      id: z.string(),
      classId: z.string(),
      order: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Deprecated: prefer `reorder`. For backward-compatibility, set the order then normalize unified list.
      const { id, order } = input;

      const current = await prisma.assignment.findUnique({
        where: { id },
        select: { id: true, classId: true },
      });

      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found' });
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.assignment.update({ where: { id }, data: { order } });

        // Normalize entire unified list
        const unified = await getUnifiedList(tx, current.classId);
        await normalizeUnifiedList(tx, current.classId, unified.map(item => ({ id: item.id, type: item.type })));

        return tx.assignment.findUnique({ where: { id } });
      });

      return updated;
    }),

    move: protectedTeacherProcedure
    .input(z.object({
      id: z.string(),
      classId: z.string(),
      targetSectionId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id } = input;
      const targetSectionId = (input.targetSectionId ?? null) || null; // normalize empty string to null

      const moved = await prisma.assignment.findUnique({
        where: { id },
        select: { id: true, classId: true, sectionId: true },
      });

      if (!moved) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignment not found' });
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Update sectionId first
        await tx.assignment.update({ where: { id }, data: { sectionId: targetSectionId } });

        // The unified list ordering remains the same, just the assignment's sectionId changed
        // No need to reorder since we're keeping the same position in the unified list
        // If frontend wants to change position, they should call reorder after move

        return tx.assignment.findUnique({ where: { id } });
      });

      return updated;
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

      // Create assignment and place at top of its scope within a single transaction
      const teacherId = ctx.user!.id;
      const assignment = await prisma.$transaction(async (tx) => {
        const created = await tx.assignment.create({
        data: {
          title,
          instructions,
          dueDate: new Date(dueDate),
          maxGrade: markSchemeId ? computedMaxGrade : maxGrade,
          graded,
          weight,
          type,
            order: 1,
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
              connect: { id: teacherId }
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

        // Insert new assignment at top of unified list and normalize
        const unified = await getUnifiedList(tx, classId);
        const withoutNew = unified.filter(item => !(item.id === created.id && item.type === 'assignment'));
        const reindexed = [{ id: created.id, type: 'assignment' as const }, ...withoutNew.map(item => ({ id: item.id, type: item.type }))];
        await normalizeUnifiedList(tx, classId, reindexed);

        return created;
      });

      // NOTE: Files are now handled via direct upload endpoints
      // The files field in the schema is for metadata only
      // Actual file uploads should use getAssignmentUploadUrls endpoint
      let uploadedFiles: UploadedFile[] = [];
      if (files && files.length > 0) {
        // Create direct upload files instead of processing base64
        uploadedFiles = await createDirectUploadFiles(files, ctx.user.id, undefined, assignment.id);
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
      
      sendNotifications(classData.students.map(student => student.id), {
        title: `🔔 New assignment for ${classData.name}`,
        content:
        `The assignment "${title}" has been created in ${classData.name}.\n
        Due date: ${new Date(dueDate).toLocaleDateString()}.
        [Link to assignment](/class/${classId}/assignments/${assignment.id})`
      }).catch(error => {
        logger.error('Failed to send assignment notifications:');
      });

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
              uploadStatus: true,
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

      // NOTE: Files are now handled via direct upload endpoints
      let uploadedFiles: UploadedFile[] = [];
      if (files && files.length > 0) {
        // Create direct upload files instead of processing base64
        uploadedFiles = await createDirectUploadFiles(files, ctx.user.id, undefined, input.id);
      }

      // Delete removed attachments from storage before updating database
      if (input.removedAttachments && input.removedAttachments.length > 0) {
        const filesToDelete = assignment.attachments.filter((file) =>
          input.removedAttachments!.includes(file.id)
        );

        // Delete files from storage (only if they were actually uploaded)
        await Promise.all(filesToDelete.map(async (file) => {
          try {
            // Only delete from GCS if the file was successfully uploaded
            if (file.uploadStatus === 'COMPLETED') {
              // Delete the main file
              await deleteFile(file.path);

              // Delete thumbnail if it exists
              if (file.thumbnail?.path) {
                await deleteFile(file.thumbnail.path);
              }
            }
          } catch (error) {
            console.warn(`Failed to delete file ${file.path}:`, error);
          }
        }));
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

      // Delete files from storage (only if they were actually uploaded)
      await Promise.all(filesToDelete.map(async (file) => {
        try {
          // Only delete from GCS if the file was successfully uploaded
          if (file.uploadStatus === 'COMPLETED') {
            // Delete the main file
            await deleteFile(file.path);

            // Delete thumbnail if it exists
            if (file.thumbnail) {
              await deleteFile(file.thumbnail.path);
            }
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
              profile: true,
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
              profile: true,
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
        uploadedFiles = await createDirectUploadFiles(newAttachments, ctx.user.id, undefined, undefined, submission.id);
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

        // Delete files from storage (only if they were actually uploaded)
        await Promise.all(filesToDelete.map(async (file) => {
          try {
            // Only delete from GCS if the file was successfully uploaded
            if (file.uploadStatus === 'COMPLETED') {
              // Delete the main file
              await deleteFile(file.path);

              // Delete thumbnail if it exists
              if (file.thumbnail?.path) {
                await deleteFile(file.thumbnail.path);
              }
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
              profile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                  profilePictureThumbnail: true,
                },
              },
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
                profile: {
                  select: {
                    displayName: true,
                    profilePicture: true,
                    profilePictureThumbnail: true,
                  },
                },
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

      // NOTE: Teacher annotation files are now handled via direct upload endpoints
      // Use getAnnotationUploadUrls and confirmAnnotationUpload endpoints instead
      // The newAttachments field is deprecated for annotations
      if (newAttachments && newAttachments.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Direct file upload is deprecated. Use getAnnotationUploadUrls endpoint instead.",
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

        // Delete files from storage (only if they were actually uploaded)
        await Promise.all(filesToDelete.map(async (file) => {
          try {
            // Only delete from GCS if the file was successfully uploaded
            if (file.uploadStatus === 'COMPLETED') {
              // Delete the main file
              await deleteFile(file.path);

              // Delete thumbnail if it exists
              if (file.thumbnail?.path) {
                await deleteFile(file.thumbnail.path);
              }
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
              profile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                  profilePictureThumbnail: true,
                },
              },
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

  // New direct upload endpoints
  getAssignmentUploadUrls: protectedTeacherProcedure
    .input(getAssignmentUploadUrlsSchema)
    .mutation(async ({ ctx, input }) => {
      const { assignmentId, classId, files } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to upload files",
        });
      }

      // Verify user is a teacher of the class
      const classData = await prisma.class.findFirst({
        where: {
          id: classId,
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

      // Verify assignment exists and belongs to the class
      const assignment = await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          classId: classId,
        },
      });

      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Assignment not found",
        });
      }

      // Create direct upload files
      const directUploadFiles = await createDirectUploadFiles(
        files,
        ctx.user.id,
        undefined, // No specific directory
        assignmentId
      );

      return {
        success: true,
        uploadFiles: directUploadFiles,
      };
    }),

  getSubmissionUploadUrls: protectedClassMemberProcedure
    .input(getSubmissionUploadUrlsSchema)
    .mutation(async ({ ctx, input }) => {
      const { submissionId, classId, files } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to upload files",
        });
      }

      // Verify submission exists and user has access
      const submission = await prisma.submission.findFirst({
        where: {
          id: submissionId,
          assignment: {
            classId: classId,
          },
        },
        include: {
          assignment: {
            include: {
              class: {
                include: {
                  students: true,
                  teachers: true,
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

      // Check if user is the student who owns the submission or a teacher of the class
      const isStudent = submission.studentId === ctx.user.id;
      const isTeacher = submission.assignment.class.teachers.some(teacher => teacher.id === ctx.user?.id);

      if (!isStudent && !isTeacher) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to upload files to this submission",
        });
      }

      // Create direct upload files
      const directUploadFiles = await createDirectUploadFiles(
        files,
        ctx.user.id,
        undefined, // No specific directory
        undefined, // No assignment ID
        submissionId
      );

      return {
        success: true,
        uploadFiles: directUploadFiles,
      };
    }),

  confirmAssignmentUpload: protectedTeacherProcedure
    .input(confirmAssignmentUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { fileId, uploadSuccess, errorMessage } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in",
        });
      }

      // Verify file belongs to user and is an assignment file
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: ctx.user.id,
          assignment: {
            isNot: null,
          },
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found or you don't have permission",
        });
      }

      await confirmDirectUpload(fileId, uploadSuccess, errorMessage);

      return {
        success: true,
        message: uploadSuccess ? "Upload confirmed successfully" : "Upload failed",
      };
    }),

  confirmSubmissionUpload: protectedClassMemberProcedure
    .input(confirmSubmissionUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { fileId, uploadSuccess, errorMessage } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in",
        });
      }

      // Verify file belongs to user and is a submission file
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: ctx.user.id,
          submission: {
            isNot: null,
          },
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found or you don't have permission",
        });
      }

      await confirmDirectUpload(fileId, uploadSuccess, errorMessage);

      return {
        success: true,
        message: uploadSuccess ? "Upload confirmed successfully" : "Upload failed",
      };
    }),

  getAnnotationUploadUrls: protectedTeacherProcedure
    .input(getAnnotationUploadUrlsSchema)
    .mutation(async ({ ctx, input }) => {
      const { submissionId, classId, files } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in to upload files",
        });
      }

      // Verify submission exists and user is a teacher of the class
      const submission = await prisma.submission.findFirst({
        where: {
          id: submissionId,
          assignment: {
            classId: classId,
            class: {
              teachers: {
                some: {
                  id: ctx.user.id,
                },
              },
            },
          },
        },
      });

      if (!submission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Submission not found or you are not a teacher of this class",
        });
      }

      // Create direct upload files for annotations
      // Note: We pass submissionId as the 5th parameter, but these are annotations not submission files
      // We need to store them separately, so we'll use a different approach
      const directUploadFiles = await createDirectUploadFiles(
        files,
        ctx.user.id,
        undefined, // No specific directory
        undefined, // No assignment ID
        undefined  // Don't link to submission yet (will be linked in confirmAnnotationUpload)
      );

      // Store the submissionId in the file record so we can link it to annotations later
      await Promise.all(
        directUploadFiles.map(file =>
          prisma.file.update({
            where: { id: file.id },
            data: {
              annotationId: submissionId, // Store as annotation
            }
          })
        )
      );

      return {
        success: true,
        uploadFiles: directUploadFiles,
      };
    }),

  confirmAnnotationUpload: protectedTeacherProcedure
    .input(confirmAnnotationUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const { fileId, uploadSuccess, errorMessage } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in",
        });
      }

      // Verify file belongs to user and is an annotation file
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: ctx.user.id,
          annotationId: {
            not: null,
          },
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found or you don't have permission",
        });
      }

      await confirmDirectUpload(fileId, uploadSuccess, errorMessage);

      return {
        success: true,
        message: uploadSuccess ? "Annotation upload confirmed successfully" : "Annotation upload failed",
      };
    }),

  updateUploadProgress: protectedProcedure
    .input(updateUploadProgressSchema)
    .mutation(async ({ ctx, input }) => {
      const { fileId, progress } = input;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be logged in",
        });
      }

      // Verify file belongs to user
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: ctx.user.id,
        },
      });

      if (!file) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "File not found or you don't have permission",
        });
      }

      await updateUploadProgress(fileId, progress);

      return {
        success: true,
        progress,
      };
    }),
});


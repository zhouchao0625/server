import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { GenerationStatus, WorksheetQuestionType } from "@prisma/client";
import { commentSelect } from "./comment.js";

type MCQOptions = {
  id: string;
  text: string;
  isCorrect: boolean;
}[];

export const worksheetRouter = createTRPCRouter({
  // Get a single worksheet with all questions
  getWorksheet: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { worksheetId } = input;

      const worksheet = await prisma.worksheet.findUnique({
        where: { id: worksheetId },
        include: {
          questions: {
            orderBy: { createdAt: 'asc' },
            // select: { id: true, type: true, question: true, answer: true, points: true },
          },
          class: true,
        },
      });

      if (!worksheet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Worksheet not found' });
      }

      return worksheet;
    }),

  // List all worksheets for a class
  listWorksheets: protectedProcedure
    .input(z.object({
      classId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { classId } = input;

      const worksheets = await prisma.worksheet.findMany({
        where: { classId },
        include: {
          questions: {
            select: { id: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return worksheets.map(worksheet => ({
        ...worksheet,
        questionCount: worksheet.questions.length,
      }));
    }),

  // Update worksheet metadata
  updateWorksheet: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
      name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetId, name } = input;

      const worksheet = await prisma.worksheet.update({
        where: { id: worksheetId },
        data: {
          ...(name !== undefined && { name }),
        },
      });

      return worksheet;
    }),

  // Delete a worksheet
  deleteWorksheet: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetId } = input;

      // This will cascade delete all questions and responses
      const deletedWorksheet = await prisma.worksheet.delete({
        where: { id: worksheetId },
      });

      return deletedWorksheet;
    }),

  create: protectedProcedure
    .input(z.object({
      classId: z.string(),
      name: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { classId, name } = input;

      // Create the worksheet
      const worksheet = await prisma.worksheet.create({
        data: {
          name,
          classId,
        },
      });

      return worksheet;
    }),
  addQuestion: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
      question: z.string(),
      answer: z.string(),
      points: z.number().optional(),
      options: z.any().optional(), // JSON field
      markScheme: z.any().optional(), // JSON field
      type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'LONG_ANSWER', 'MATH_EXPRESSION', 'ESSAY']),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetId, question, points, answer, options, markScheme, type } = input;

      const worksheet = await prisma.worksheet.findUnique({
        where: { id: worksheetId },
      });

      if (!worksheet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Worksheet not found' });
      }

      const newQuestion = await prisma.worksheetQuestion.create({
        data: {
          worksheetId,
          type,
          points,
          question,
          answer,
          options,
          markScheme,
        },
      });

      return newQuestion;
    }),
  reorderQuestions: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
      movedId: z.string(),
      position: z.enum(['before', 'after']),
      targetId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetId, movedId, position, targetId } = input;

      const worksheet = await prisma.worksheet.findUnique({
        where: { id: worksheetId },
      });

      if (!worksheet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Worksheet not found' });
      }

      const questions = await prisma.worksheetQuestion.findMany({
        where: { worksheetId },
        orderBy: { order: 'asc' },
      });

      const movedIdx = questions.findIndex(question => question.id === movedId);
      if (movedIdx === -1) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Moved question not found' });
      }

      const targetIdx = questions.findIndex(question => question.id === targetId);
      if (targetIdx === -1) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Target question not found' });
      }

      const withoutMoved = questions.filter(question => question.id !== movedId);

      let next: Array<{ id: string }> = [];

      if (position === 'before') {
        next = [...withoutMoved.slice(0, targetIdx).map(item => ({ id: item.id })), { id: movedId }, ...withoutMoved.slice(targetIdx).map(item => ({ id: item.id }))];
      } else {
        next = [...withoutMoved.slice(0, targetIdx + 1).map(item => ({ id: item.id })), { id: movedId }, ...withoutMoved.slice(targetIdx + 1).map(item => ({ id: item.id }))];
      }

      // Update the order of each question
      await prisma.$transaction(
        next.map((item, index) =>
          prisma.worksheetQuestion.update({
            where: { id: item.id },
            data: { order: index },
          })
        )
      );

      return next;
    }),
  updateQuestion: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
      questionId: z.string(),
      question: z.string().optional(),
      answer: z.string().optional(),
      points: z.number().optional(),
      options: z.any().optional(), // JSON field
      markScheme: z.any().optional(), // JSON field
      type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'LONG_ANSWER', 'MATH_EXPRESSION', 'ESSAY']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetId, questionId, points, question, answer, options, markScheme, type } = input;

      const worksheet = await prisma.worksheet.findUnique({
        where: { id: worksheetId },
      });

      if (!worksheet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Worksheet not found' });
      }

      const updatedQuestion = await prisma.worksheetQuestion.update({
        where: { id: questionId },
        data: {
          ...(question !== undefined && { question }),
          ...(answer !== undefined && { answer }),
          ...(markScheme !== undefined && { markScheme }),
          ...(type !== undefined && { type }),
          ...(options !== undefined && { options }),
          ...(points !== undefined && { points }),
        },
      });

      return updatedQuestion;
    }),
  deleteQuestion: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
      questionId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetId, questionId } = input;

      const worksheet = await prisma.worksheet.findUnique({
        where: { id: worksheetId },
      });

      if (!worksheet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Worksheet not found' });
      }

      const deletedQuestion = await prisma.worksheetQuestion.delete({
        where: { id: questionId },
      });

      return deletedQuestion;
    }),

  getWorksheetSubmission: protectedProcedure
    .input(z.object({
      worksheetId: z.string(),
      submissionId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const { worksheetId, submissionId } = input;

      const submission = await prisma.submission.findUnique({
        where: { id: submissionId },
      });

      if (!submission) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found' });
      }

      // Find or create worksheet response for this submission
      const worksheetResponse = await prisma.$transaction(async (tx) => {
        // First check if a response exists
        const existing = await tx.studentWorksheetResponse.findFirst({
          where: { 
            submissionId,
            worksheetId 
          },
          include: {
            responses: {
              include: {
                comments: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        });

        if (existing) {
          return existing;
        }

        // Create new response if it doesn't exist
        const created = await tx.studentWorksheetResponse.create({
          data: {
            worksheetId,
            submissionId,
            studentId: submission.studentId,
          },
          include: {
            responses: {
              include: {
                comments: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        });

        return created;
      });


      return worksheetResponse;
    }),
  answerQuestion: protectedProcedure
    .input(z.object({
      worksheetResponseId: z.string(),
      questionId: z.string(),
      response: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetResponseId, questionId, response } = input;

      const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId },
        include: {
          responses: {
            where: { questionId },
          },
        },
      });

      if (!worksheetResponse) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Worksheet response not found' });
      }

      const question = await prisma.worksheetQuestion.findUnique({
        where: { id: questionId },
      });

      const isMarkableByAlgo = question?.type === 'MULTIPLE_CHOICE' || question?.type === 'TRUE_FALSE';
      const marksAwardedIfCorrect = question?.points || 0;
    
      const correctAnswer = isMarkableByAlgo ? (question?.type === 'MULTIPLE_CHOICE' ? (question?.options as MCQOptions).find((option) => option.isCorrect)?.id : question?.answer.toString()) : null;

      // Check if a response already exists for this question
      const existingResponse = worksheetResponse.responses[0];

      if (existingResponse) {
        // Update existing response
        await prisma.studentQuestionProgress.update({
          where: { id: existingResponse.id },
          data: { response, 
            ...(isMarkableByAlgo && { isCorrect: response === correctAnswer }),
            ...(isMarkableByAlgo && { points: response === correctAnswer ? marksAwardedIfCorrect : 0 }),
            status: GenerationStatus.NOT_STARTED,
           },
        });
      } else {
        // Create new response
        await prisma.studentQuestionProgress.create({
          data: {
            studentId: worksheetResponse.studentId,
            questionId,
            response,
            studentWorksheetResponseId: worksheetResponseId,
            ...(isMarkableByAlgo && { isCorrect: response === correctAnswer }),
            ...(isMarkableByAlgo && { points: response === correctAnswer ? marksAwardedIfCorrect : 0 }),
          },
        });
      }

      // Return the updated worksheet response with all responses
      const updatedWorksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId },
        include: {
          responses: true,
        },
      });

      return updatedWorksheetResponse;
    }),
  cancelAutoGrading: protectedProcedure
    .input(z.object({
      worksheetResponseId: z.string(),
      questionId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { worksheetResponseId, questionId } = input;

      const updatedQuestion = await prisma.studentQuestionProgress.update({
        where: { id: questionId, studentWorksheetResponseId: worksheetResponseId },
        data: {
          status: GenerationStatus.CANCELLED,
        },
      });

      return updatedQuestion;
    }),
  // Grade a student's answer
  gradeAnswer: protectedProcedure
    .input(z.object({
      questionId: z.string(),
      responseId: z.string().optional(), // StudentQuestionProgress ID (optional for upsert)
      studentWorksheetResponseId: z.string(), // Required for linking to worksheet response
      response: z.string().optional(), // The actual response text (needed if creating new)
      isCorrect: z.boolean(),
      feedback: z.string().optional(),
      markschemeState: z.any().optional(),
      points: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { responseId, questionId, studentWorksheetResponseId, response, isCorrect, feedback, markschemeState, points } = input;

      let gradedResponse;
      
      if (responseId) {
        // Update existing progress by ID
        gradedResponse = await prisma.studentQuestionProgress.update({
          where: { id: responseId },
          data: {
            isCorrect,
            ...(feedback !== undefined && { feedback }),
            ...(markschemeState !== undefined && { markschemeState }),
            ...(points !== undefined && { points }),
          },
        });
      } else {
        // Get the studentId from the worksheet response
        const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
          where: { id: studentWorksheetResponseId },
          select: { studentId: true },
        });

        if (!worksheetResponse) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Student worksheet response not found',
          });
        }

        const { studentId } = worksheetResponse;

        // Upsert - find or create the progress record
        const existing = await prisma.studentQuestionProgress.findFirst({
          where: {
            studentId,
            questionId,
            studentWorksheetResponseId,
          },
        });

        if (existing) {
          // Update existing
          gradedResponse = await prisma.studentQuestionProgress.update({
            where: { id: existing.id },
            data: {
              isCorrect,
              ...(response !== undefined && { response }),
              ...(feedback !== undefined && { feedback }),
              ...(markschemeState !== undefined && { markschemeState }),
              ...(points !== undefined && { points }),
            },
          });
        } else {
          // Create new
          gradedResponse = await prisma.studentQuestionProgress.create({
            data: {
              studentId,
              questionId,
              studentWorksheetResponseId,
              response: response || '',
              isCorrect,
              ...(feedback !== undefined && { feedback }),
              ...(markschemeState !== undefined && { markschemeState }),
              ...(points !== undefined && { points: points || 0 }),
            },
          });
        }
      }

      return gradedResponse;
    }),
    addComment: protectedProcedure
    .input(z.object({
      responseId: z.string(),
      comment: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { responseId, comment } = input;

      const newComment = await prisma.comment.create({
        data: {
          studentQuestionProgressId: responseId,
          content: comment,
          authorId: ctx.user!.id,
        },
      });

      return newComment;
    }),
});
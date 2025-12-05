import { GenerationStatus, WorksheetQuestionType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import z from "zod";
import { inference } from "../../utils/inference.js";
import { getAIUserId } from "../../utils/aiUser.js";
import { pusher } from "../../lib/pusher.js";

/**
 * Grades and regrades worksheet (can fixed failed responses)
 * @param worksheetResponseId worksheet response id
 * @returns updated worksheet response
 */

const DO_NOT_INFERENCE_STATUSES = [GenerationStatus.CANCELLED, GenerationStatus.PENDING, GenerationStatus.COMPLETED];

export const gradeWorksheetPipeline = async (worksheetResponseId: string) => {
    logger.info('Grading worksheet response', { worksheetResponseId });
    const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId },
        include: {
            worksheet: true,
            responses: {
                where: {
                    status: {
                        not: {
                            in: DO_NOT_INFERENCE_STATUSES,
                        },
                    },
                    question: {
                        type: {
                            not: {
                                in: [WorksheetQuestionType.MULTIPLE_CHOICE, WorksheetQuestionType.TRUE_FALSE],
                            }
                        },
                    },
                },
                include: {
                    question: true,
                    comments: true,
                },
            },
        },
    });

    console.log(worksheetResponse);

    if (!worksheetResponse) {
        logger.error('Worksheet response not found');
        throw new Error('Worksheet response not found');
    }

    worksheetResponse.responses.forEach(async (response) => {
        logger.info('Grading question', { questionId: response.questionId });
        const question = response.question;
        const comments = response.comments;
        const responseText = response.response;

        const studentQuestionProgress = await prisma.studentQuestionProgress.update({
            where: { id: response.id, status: {
                not: {
                    in: DO_NOT_INFERENCE_STATUSES,
                }
            } },
            data: { status: GenerationStatus.PENDING },
        });

        if (studentQuestionProgress.status !== GenerationStatus.PENDING) {
            return;
        }

        try {
            const apiResponse = await inference(
                `Grade the following worksheet response:
                
                Question: ${question.question}
                Response: ${responseText}

                Comments: ${comments.map((comment) => comment.content).join('\n')}
                Mark Scheme: ${JSON.stringify(question.markScheme)}
                
                Justify your reasoning by including comment(s) and mark the question please.         
                Return ONLY JSON in the following format (fill in the values as per the question):
               {
                "isCorrect": <boolean>,
                "points": <number>,
                "markschemeState": [
                    { "id": <string>, "correct": <boolean> }
                ],
                "comments": [<string>, ...]
                }
                `,
                z.object({
                    isCorrect: z.boolean(),
                    points: z.number(),
                    markschemeState: z.array(z.object({
                        id: z.string(),
                        correct: z.boolean(),
                      })), // @note: this has to be converted to [id: string]: correct boolean
                    comments: z.array(z.string()),
                }),
            ).catch((error) => {
                logger.error('Failed to grade worksheet response', { error });
                throw error;
            });

            console.log(apiResponse);

            const updatedStudentQuestionProgress = await prisma.studentQuestionProgress.update({
                where: { id: studentQuestionProgress.id, status: {
                    not: {
                        in: ['CANCELLED'],
                    },
                } },
                data: {
                    status: GenerationStatus.COMPLETED,
                    isCorrect: (apiResponse as { isCorrect: boolean }).isCorrect,
                    points: (apiResponse as { points: number }).points,
                    markschemeState: (apiResponse as {
                        markschemeState: { id: string; correct: boolean }[];
                    }).markschemeState.reduce((acc, curr) => {
                        acc["item-" + curr.id] = curr.correct;
                        return acc;
                    }, {} as Record<string, boolean>),
                    comments: {
                        create: (apiResponse as {
                            comments: string[];
                        }).comments.map((commentContent) => ({
                            content: commentContent,
                            authorId: getAIUserId(),
                        })),
                    },
                },
            });
            pusher.trigger(`class-${worksheetResponse.worksheet.classId}`, `ai-worksheet-updated-${worksheetResponse.id}`, {
                success: true,
            });

            return updatedStudentQuestionProgress;
        } catch (error) {
            logger.error('Failed to grade worksheet response', { error, worksheetResponseId });
            pusher.trigger(`class-${worksheetResponse.worksheet.classId}`, `ai-worksheet-updated-${worksheetResponse.id}`, {
                success: false,
            });
            await prisma.studentQuestionProgress.update({
                where: { id: studentQuestionProgress.id },
                data: { status: GenerationStatus.FAILED },
            });
            throw error;
        }
    });
};
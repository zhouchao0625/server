import { getAIUserId } from "../../utils/aiUser";
import { prisma } from "../../lib/prisma.js";
import { Assignment, Class, File, GenerationStatus, User } from "@prisma/client";
import { inference } from "../../utils/inference.js";
import z from "zod";

const aiLabChatResponseSchema = z.object({
    content: z.string(),
    attachments: z.array(z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        type: z.string(),
        size: z.number(),
    })),
    assignmentsToCreate: z.array(z.object({
        title: z.string(),
        instructions: z.string(),
        dueDate: z.date(),
        acceptFiles: z.boolean(),
        acceptExtendedResponse: z.boolean(),
        acceptWorksheet: z.boolean(),
        maxGrade: z.number(),
        gradingBoundaryId: z.string(),
        markschemeId: z.string(),
        worksheetIds: z.array(z.string()),
        studentIds: z.array(z.string()),
        sectionId: z.string(),
        type: z.enum(['HOMEWORK', 'QUIZ', 'TEST', 'PROJECT', 'ESSAY', 'DISCUSSION', 'PRESENTATION', 'LAB', 'OTHER']),
        attachments: z.array(z.object({
            id: z.string(),
        })),
    })),
});


const getBaseSystemPrompt = (context: Class & { members: User[] , assignments: Assignment[], files: File[] }) => {
    const systemPrompt = `
    # Basic Information
    You are a helpful assistant that helps teachers create course materials for their students.
    You are provided with the following context:

    Class information: ${context.name} - ${context.subject}
    Students: ${JSON.stringify(context.members)}
    Assignments: ${JSON.stringify(context.assignments)}
    Files: ${JSON.stringify(context.files)}

    You are to generate a response to the user's message.
    If contextually they would like a file, you are to generate a file.
    And so on... same for assignments, worksheets, etc.

    You are to generate a response in the following format:
    {
        content: string,
        attachments: File[],
        assignmentsToCreate: Assignment[],
    }

    NOTE:
    - for attachments in Assignment, you may only attach to existing files, based on the file ids provided. if you need to create files and assignments, let the user know that this will take two operations.
    - the user must accept your changes before they are applied. do know this.
    - 
    `;
}



/**
 * Generate labchat responses
 * Allow for the generation of the following:
 * - Assignment(s) either individual or bulk as an lesson / course plan.
 * - Worksheet(s) either individual or bulk as an lesson / course plan.
 * - Files (PDFs)
 * @param labChatId 
 */
// export const sendAiLabChatResponsePipeline = async (labChatId: string) => {
//     const message = await prisma?.message.create({
//         data: {
//             content: "GENERATING_CONTENT",
//             senderId: getAIUserId(),
//             conversationId: labChatId,
//             status: GenerationStatus.PENDING,   
//         },
//     });

//     try {

//         inference(`
//         `)
//     }
    
// };
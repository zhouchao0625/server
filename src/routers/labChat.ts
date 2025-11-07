import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';
import { 
  inferenceClient,
  sendAIMessage,
  type LabChatContext 
} from '../utils/inference.js';
import { logger } from '../utils/logger.js';
import { isAIUser } from '../utils/aiUser.js';
import { bucket } from '../lib/googleCloudStorage.js';
import { createPdf } from "../lib/jsonConversion.js"
import OpenAI from 'openai';
import { v4 as uuidv4 } from "uuid";

export const labChatRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        classId: z.string(),
        title: z.string().min(1).max(200),
        context: z.string(), // JSON string for LLM context
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { classId, title, context } = input;

      // Verify user is a teacher in the class
      const classWithTeachers = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: {
              id: userId,
            },
          },
        },
        include: {
          students: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                },
              },
            },
          },
          teachers: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
      });

      if (!classWithTeachers) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a teacher in this class',
        });
      }

      // Validate context is valid JSON
      try {
        JSON.parse(context);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Context must be valid JSON',
        });
      }

      // Create lab chat with associated conversation
      const result = await prisma.$transaction(async (tx) => {
        // Create conversation for the lab chat
        const conversation = await tx.conversation.create({
          data: {
            type: 'GROUP',
            name: `Lab: ${title}`,
            displayInChat: false, // Lab chats don't show in regular chat list
          },
        });

        // Add only teachers to the conversation (this is for course material creation)
        const teacherMembers = classWithTeachers.teachers.map(t => ({ 
          userId: t.id, 
          role: 'ADMIN' as const 
        }));

        await tx.conversationMember.createMany({
          data: teacherMembers.map(member => ({
            userId: member.userId,
            conversationId: conversation.id,
            role: member.role,
          })),
        });

        // Create the lab chat
        const labChat = await tx.labChat.create({
          data: {
            title,
            context,
            classId,
            conversationId: conversation.id,
            createdById: userId,
          },
          include: {
            conversation: {
              include: {
                members: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        username: true,
                        profile: {
                          select: {
                            displayName: true,
                            profilePicture: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            createdBy: {
              select: {
                id: true,
                username: true,
                profile: {
                  select: {
                    displayName: true,
                  },
                },
              },
            },
            class: {
              select: {
                id: true,
                name: true,
                subject: true,
                section: true,
              },
            },
          },
        });

        return labChat;
      });

      // Generate AI introduction message in parallel (don't await - fire and forget)
      generateAndSendLabIntroduction(result.id, result.conversationId, context, classWithTeachers.subject || 'Lab').catch(error => {
        logger.error('Failed to generate AI introduction:', { error, labChatId: result.id });
      });

      // Broadcast lab chat creation to class members
      try {
        await pusher.trigger(`class-${classId}`, 'lab-chat-created', {
          id: result.id,
          title: result.title,
          classId: result.classId,
          conversationId: result.conversationId,
          createdBy: result.createdBy,
          createdAt: result.createdAt,
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat creation:', error);
        // Don't fail the request if Pusher fails
      }

      return result;
    }),

  get: protectedProcedure
    .input(z.object({ labChatId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { labChatId } = input;

      // First, try to find the lab chat if user is already a member
      let labChat = await prisma.labChat.findFirst({
        where: {
          id: labChatId,
          conversation: {
            members: {
              some: {
                userId,
              },
            },
          },
        },
        include: {
          conversation: {
            include: {
              members: {
                include: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                      profile: {
                        select: {
                          displayName: true,
                          profilePicture: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                },
              },
            },
          },
          class: {
            select: {
              id: true,
              name: true,
              subject: true,
              section: true,
            },
          },
        },
      });

      // If not found, check if user is a teacher in the class
      if (!labChat) {
        const labChatForTeacher = await prisma.labChat.findFirst({
          where: {
            id: labChatId,
            class: {
              teachers: {
                some: {
                  id: userId,
                },
              },
            },
          },
          include: {
            conversation: {
              select: {
                id: true,
              },
            },
          },
        });

        if (labChatForTeacher) {
          // Add teacher to conversation
          await prisma.conversationMember.create({
            data: {
              userId,
              conversationId: labChatForTeacher.conversation.id,
              role: 'ADMIN',
            },
          });

          // Now fetch the full lab chat with the user as a member
          labChat = await prisma.labChat.findFirst({
            where: {
              id: labChatId,
            },
            include: {
              conversation: {
                include: {
                  members: {
                    include: {
                      user: {
                        select: {
                          id: true,
                          username: true,
                          profile: {
                            select: {
                              displayName: true,
                              profilePicture: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              createdBy: {
                select: {
                  id: true,
                  username: true,
                  profile: {
                    select: {
                      displayName: true,
                    },
                  },
                },
              },
              class: {
                select: {
                  id: true,
                  name: true,
                  subject: true,
                  section: true,
                },
              },
            },
          });
        }
      }

      if (!labChat) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Lab chat not found or access denied',
        });
      }

      return labChat;
    }),

  list: protectedProcedure
    .input(z.object({ classId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { classId } = input;

      // Verify user is a member of the class
      const classMembership = await prisma.class.findFirst({
        where: {
          id: classId,
          OR: [
            {
              students: {
                some: {
                  id: userId,
                },
              },
            },
            {
              teachers: {
                some: {
                  id: userId,
                },
              },
            },
          ],
        },
      });

      if (!classMembership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this class',
        });
      }

      const labChats = await prisma.labChat.findMany({
        where: {
          classId,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                },
              },
            },
          },
          conversation: {
            include: {
              messages: {
                orderBy: {
                  createdAt: 'desc',
                },
                take: 1,
                include: {
                  sender: {
                    select: {
                      id: true,
                      username: true,
                      profile: {
                        select: {
                          displayName: true,
                        },
                      },
                    },
                  },
                },
              },
              _count: {
                select: {
                  messages: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return labChats.map((labChat) => ({
        id: labChat.id,
        title: labChat.title,
        classId: labChat.classId,
        conversationId: labChat.conversationId,
        createdBy: labChat.createdBy,
        createdAt: labChat.createdAt,
        updatedAt: labChat.updatedAt,
        lastMessage: labChat.conversation.messages[0] || null,
        messageCount: labChat.conversation._count.messages,
      }));
    }),

  postToLabChat: protectedProcedure
    .input(
      z.object({
        labChatId: z.string(),
        content: z.string().min(1).max(4000),
        mentionedUserIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { labChatId, content, mentionedUserIds = [] } = input;

      // Get lab chat and verify user is a member
      const labChat = await prisma.labChat.findFirst({
        where: {
          id: labChatId,
          conversation: {
            members: {
              some: {
                userId,
              },
            },
          },
        },
        include: {
          conversation: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!labChat) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Lab chat not found or access denied',
        });
      }

      // Verify mentioned users are members of the conversation
      if (mentionedUserIds.length > 0) {
        const mentionedMemberships = await prisma.conversationMember.findMany({
          where: {
            conversationId: labChat.conversationId,
            userId: { in: mentionedUserIds },
          },
        });

        if (mentionedMemberships.length !== mentionedUserIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Some mentioned users are not members of this lab chat',
          });
        }
      }

      // Create message and mentions
      const result = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            content,
            senderId: userId,
            conversationId: labChat.conversationId,
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profile: {
                  select: {
                    displayName: true,
                    profilePicture: true,
                  },
                },
              },
            },
          },
        });

        // Create mentions
        if (mentionedUserIds.length > 0) {
          await tx.mention.createMany({
            data: mentionedUserIds.map((mentionedUserId) => ({
              messageId: message.id,
              userId: mentionedUserId,
            })),
          });
        }

        // Update lab chat timestamp
        await tx.labChat.update({
          where: { id: labChatId },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      // Broadcast to Pusher channel (same format as regular chat)
      try {
        await pusher.trigger(`conversation-${labChat.conversationId}`, 'new-message', {
          id: result.id,
          content: result.content,
          senderId: result.senderId,
          conversationId: result.conversationId,
          createdAt: result.createdAt,
          sender: result.sender,
          mentionedUserIds,
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat message:', error);
        // Don't fail the request if Pusher fails
      }

        // Generate AI response in parallel (don't await - fire and forget)
        if (!isAIUser(userId)) {
          // Run AI response generation in background
          generateAndSendLabResponse(labChatId, content, labChat.conversationId).catch(error => {
            logger.error('Failed to generate AI response:', { error });
          });
        }

      return {
        id: result.id,
        content: result.content,
        senderId: result.senderId,
        conversationId: result.conversationId,
        createdAt: result.createdAt,
        sender: result.sender,
        mentionedUserIds,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ labChatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { labChatId } = input;

      // Verify user is the creator of the lab chat
      const labChat = await prisma.labChat.findFirst({
        where: {
          id: labChatId,
          createdById: userId,
        },
      });

      if (!labChat) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Lab chat not found or not the creator',
        });
      }

      // Delete lab chat and associated conversation
      await prisma.$transaction(async (tx) => {
        // Delete mentions first
        await tx.mention.deleteMany({
          where: {
            message: {
              conversationId: labChat.conversationId,
            },
          },
        });

        // Delete messages
        await tx.message.deleteMany({
          where: {
            conversationId: labChat.conversationId,
          },
        });

        // Delete conversation members
        await tx.conversationMember.deleteMany({
          where: {
            conversationId: labChat.conversationId,
          },
        });

        // Delete lab chat
        await tx.labChat.delete({
          where: { id: labChatId },
        });

        // Delete conversation
        await tx.conversation.delete({
          where: { id: labChat.conversationId },
        });
      });

      // Broadcast lab chat deletion
      try {
        await pusher.trigger(`class-${labChat.classId}`, 'lab-chat-deleted', {
          labChatId,
          classId: labChat.classId,
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat deletion:', error);
        // Don't fail the request if Pusher fails
      }

      return { success: true };
    }),
});

/**
 * Generate and send AI introduction for lab chat
 * Uses the stored context directly from database
 */
async function generateAndSendLabIntroduction(
  labChatId: string,
  conversationId: string,
  contextString: string,
  subject: string
): Promise<void> {
  try {
    // Enhance the stored context with clarifying question instructions
    const enhancedSystemPrompt = `${contextString}

IMPORTANT INSTRUCTIONS:
- You are helping teachers create course materials
- Use the context information provided above (subject, topic, difficulty, objectives, etc.) as your foundation
- Only ask clarifying questions about details NOT already specified in the context
- Focus your questions on format preferences, specific requirements, or missing details needed to create the content
- Only output final course materials when you have sufficient details beyond what's in the context
- Do not use markdown formatting in your responses - use plain text only
- When creating content, make it clear and well-structured without markdown`;

    const completion = await inferenceClient.chat.completions.create({
      model: 'command-a-03-2025',
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        { 
          role: 'user', 
          content: 'Please introduce yourself to the teaching team. Explain that you will help create course materials by first asking clarifying questions based on the context provided, and only output final content when you have enough information.' 
        },
      ],
      max_tokens: 300,
      temperature: 0.8,
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response generated from inference API');
    }

    // Send AI introduction using centralized sender
    await sendAIMessage(response, conversationId, {
      subject,
    });

    logger.info('AI Introduction sent', { labChatId, conversationId });

  } catch (error) {
    logger.error('Failed to generate AI introduction:', { error, labChatId });
    
    // Send fallback introduction
    try {
      const fallbackIntro = `Hello teaching team! I'm your AI assistant for course material development. I will help you create educational content by first asking clarifying questions based on the provided context, then outputting final materials when I have sufficient information. I won't use markdown formatting in my responses. What would you like to work on?`;
      
      await sendAIMessage(fallbackIntro, conversationId, {
        subject,
      });

      logger.info('Fallback AI introduction sent', { labChatId });

    } catch (fallbackError) {
      logger.error('Failed to send fallback AI introduction:', { error: fallbackError, labChatId });
    }
  }
}

/**
 * Generate and send AI response to teacher message
 * Uses the stored context directly from database
 */
async function generateAndSendLabResponse(
  labChatId: string,
  teacherMessage: string,
  conversationId: string
): Promise<void> {
  try {
    // Get lab context from database
    const fullLabChat = await prisma.labChat.findUnique({
      where: { id: labChatId },
      include: {
        class: {
          select: {
            name: true,
            subject: true,
          },
        },
      },
    });

    if (!fullLabChat) {
      throw new Error('Lab chat not found');
    }

    // Get recent conversation history
    const recentMessages = await prisma.message.findMany({
      where: {
        conversationId,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10, // Last 10 messages for context
    });

    // Build conversation history as proper message objects
    // Enhance the stored context with clarifying question instructions
    const enhancedSystemPrompt = `${fullLabChat.context}

IMPORTANT INSTRUCTIONS:
- Use the context information provided above (subject, topic, difficulty, objectives, etc.) as your foundation
- Based on the teacher's input and existing context, only ask clarifying questions about details NOT already specified
- Focus questions on format preferences, specific requirements, quantity, or missing implementation details
- Only output final course materials when you have sufficient details beyond what's in the context
- Do not use markdown formatting in your responses - use plain text only
- When you do create content, make it clear and well-structured without markdown
- If the request is vague, ask 1-2 specific clarifying questions about missing details only
- You are primarily a chatbot - only provide files when it is necessary

RESPONSE FORMAT:
- Always respond with JSON in this format: { "text": string, "docs": null | array }
- "text": Your conversational response (questions, explanations, etc.) - use plain text, no markdown
- "docs": null for regular conversation, or array of PDF document objects when creating course materials

WHEN CREATING COURSE MATERIALS (docs field):
- docs: [ { "title": string, "blocks": [ { "format": <int 0-12>, "content": string | string[], "metadata"?: { fontSize?: number, lineHeight?: number, paragraphSpacing?: number, indentWidth?: number, paddingX?: number, paddingY?: number, font?: 0|1|2|3|4|5, color?: "#RGB"|"#RRGGBB", background?: "#RGB"|"#RRGGBB", align?: "left"|"center"|"right" } } ] } ]
- Each document in the array should have a "title" (used for filename) and "blocks" (content)
- You can create multiple documents when it makes sense (e.g., separate worksheets, answer keys, different topics)
- Use descriptive titles like "Biology_Cell_Structure_Worksheet" or "Chemistry_Lab_Instructions"
- Format enum (integers): 0=HEADER_1, 1=HEADER_2, 2=HEADER_3, 3=HEADER_4, 4=HEADER_5, 5=HEADER_6, 6=PARAGRAPH, 7=BULLET, 8=NUMBERED, 9=TABLE, 10=IMAGE, 11=CODE_BLOCK, 12=QUOTE
- Fonts enum: 0=TIMES_ROMAN, 1=COURIER, 2=HELVETICA, 3=HELVETICA_BOLD, 4=HELVETICA_ITALIC, 5=HELVETICA_BOLD_ITALIC
- Colors must be hex strings: "#RGB" or "#RRGGBB".
- Headings (0-5): content is a single string; you may set metadata.align.
- Paragraphs (6) and Quotes (12): content is a single string.
- Bullets (7) and Numbered (8): content is an array of strings (one item per list entry). DO NOT include bullet symbols (*) or numbers (1. 2. 3.) in the content - the format will automatically add these.
- Code blocks (11): prefer content as an array of lines; preserve indentation via leading tabs/spaces. If using a single string, include \n between lines.
- Table (9) and Image (10) are not supported by the renderer now; do not emit them.
- Use metadata sparingly; omit fields you don't need. For code blocks you may set metadata.paddingX, paddingY, background, and font (1 for Courier).
- Wrap text naturally; do not insert manual line breaks except where semantically required (lists, code).
- The JSON must be valid and ready for PDF rendering by the server.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: enhancedSystemPrompt },
    ];

    // Add recent conversation history
    recentMessages.reverse().forEach(msg => {
      const role = isAIUser(msg.senderId) ? 'assistant' : 'user';
      const senderName = msg.sender?.profile?.displayName || msg.sender?.username || 'Teacher';
      const content = isAIUser(msg.senderId) ? msg.content : `${senderName}: ${msg.content}`;
      
      messages.push({
        role: role as 'user' | 'assistant',
        content,
      });
    });

    // Add the new teacher message
    const senderName = 'Teacher'; // We could get this from the actual sender if needed
    messages.push({
      role: 'user',
      content: `${senderName}: ${teacherMessage}`,
    });


    const completion = await inferenceClient.chat.completions.create({
      model: 'command-a-03-2025',
      messages,
      temperature: 0.7,
      response_format: {
        type: "json_object",
        // @ts-expect-error
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            docs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  blocks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        format: { type: "integer", minimum: 0, maximum: 12 },
                        content: {
                          oneOf: [
                            { type: "string" },
                            { type: "array", items: { type: "string" } }
                          ]
                        },
                        metadata: {
                          type: "object",
                          properties: {
                            fontSize: { type: "number", minimum: 6 },
                            lineHeight: { type: "number", minimum: 0.6 },
                            paragraphSpacing: { type: "number", minimum: 0 },
                            indentWidth: { type: "number", minimum: 0 },
                            paddingX: { type: "number", minimum: 0 },
                            paddingY: { type: "number", minimum: 0 },
                            font: { type: "integer", minimum: 0, maximum: 5 },
                            color: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
                            background: { type: "string", pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
                            align: { type: "string", enum: ["left", "center", "right"] }
                          },
                          additionalProperties: false
                        }
                      },
                      required: ["format", "content"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["title", "blocks"],
                additionalProperties: false
              }
            }
          },
          required: ["text"],
          additionalProperties: false
        }
      },
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response generated from inference API');
    }

    // Parse the JSON response and generate PDF if docs are provided
    try {
      const jsonData = JSON.parse(response);


      const attachmentIds: string[] = [];
      // Generate PDFs if docs are provided
      if (jsonData.docs && Array.isArray(jsonData.docs)) {
        

        console.log('Generating PDFs', { labChatId, docs: JSON.stringify(jsonData.docs, null, 2) });
        for (let i = 0; i < jsonData.docs.length; i++) {
          const doc = jsonData.docs[i];
          if (!doc.title || !doc.blocks || !Array.isArray(doc.blocks)) {
            logger.error(`Document ${i + 1} is missing title or blocks`);
            continue;
          } 


          try {
            let pdfBytes = await createPdf(doc.blocks);            
            if (pdfBytes) {
              // Sanitize filename - remove special characters and limit length
              const sanitizedTitle = doc.title
                .replace(/[^a-zA-Z0-9\s\-_]/g, '')
                .replace(/\s+/g, '_')
                .substring(0, 50);
              
              const filename = `${sanitizedTitle}_${uuidv4().substring(0, 8)}.pdf`;
              const filePath = `class/generated/${fullLabChat.classId}/${filename}`;

              logger.info(`PDF ${i + 1} generated successfully`, { labChatId, title: doc.title });
              
              // Upload directly to Google Cloud Storage
              const gcsFile = bucket.file(filePath);
              await gcsFile.save(Buffer.from(pdfBytes), {
                metadata: {
                  contentType: 'application/pdf',
                }
              });
    
              logger.info(`PDF ${i + 1} uploaded successfully`, { labChatId, filename });

              const file = await prisma.file.create({
                data: {
                  name: filename,
                  path: filePath,
                  type: 'application/pdf',
                  size: pdfBytes.length,
                  userId: fullLabChat.createdById,
                  uploadStatus: 'COMPLETED',
                  uploadedAt: new Date(),
                },
              });
              attachmentIds.push(file.id);
            } else {
              logger.error(`PDF ${i + 1} creation returned undefined/null`, { labChatId, title: doc.title });
            }
          } catch (pdfError) {
            logger.error(`PDF creation threw an error for document ${i + 1}:`, { 
              error: pdfError instanceof Error ? {
                message: pdfError.message,
                stack: pdfError.stack,
                name: pdfError.name
              } : pdfError, 
              labChatId,
              title: doc.title
            });
          }
        }
      }

      // Send the text response to the conversation
      await sendAIMessage(jsonData.text || response, conversationId, {
        attachments: {
          connect: attachmentIds.map(id => ({ id })),
        },
        subject: fullLabChat.class?.subject || 'Lab',
      });
    } catch (parseError) {
      logger.error('Failed to parse AI response or generate PDF:', { error: parseError, labChatId });
      // Fallback: send the raw response if parsing fails
      await sendAIMessage(response, conversationId, {
        subject: fullLabChat.class?.subject || 'Lab',
      });
    }

    logger.info('AI response sent', { labChatId, conversationId });

  } catch (error) {
    console.error('Full error object:', error);
    logger.error('Failed to generate AI response:', { 
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      labChatId 
    });
    throw error; // Re-throw to see the full error in the calling function
  }
}


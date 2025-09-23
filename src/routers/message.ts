import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';

export const messageRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId, cursor, limit } = input;

      // Verify user is a member of the conversation
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          ...(cursor && {
            createdAt: {
              lt: new Date(cursor),
            },
          }),
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
          mentions: {
            include: {
              user: {
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
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit + 1,
      });

      let nextCursor: string | undefined = undefined;
      if (messages.length > limit) {
        const nextItem = messages.pop();
        nextCursor = nextItem!.createdAt.toISOString();
      }

      return {
        messages: messages.reverse().map((message) => ({
          id: message.id,
          content: message.content,
          senderId: message.senderId,
          conversationId: message.conversationId,
          createdAt: message.createdAt,
          sender: message.sender,
          mentions: message.mentions.map((mention) => ({
            user: mention.user,
          })),
          mentionsMe: message.mentions.some((mention) => mention.userId === userId),
        })),
        nextCursor,
      };
    }),

  send: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        content: z.string().min(1).max(4000),
        mentionedUserIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId, content, mentionedUserIds = [] } = input;

      // Verify user is a member of the conversation
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Verify mentioned users are members of the conversation
      if (mentionedUserIds.length > 0) {
        const mentionedMemberships = await prisma.conversationMember.findMany({
          where: {
            conversationId,
            userId: { in: mentionedUserIds },
          },
        });

        if (mentionedMemberships.length !== mentionedUserIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Some mentioned users are not members of this conversation',
          });
        }
      }

      // Create message, mentions, and update conversation timestamp
      const result = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            content,
            senderId: userId,
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

        // Update conversation timestamp
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      // Broadcast to Pusher channel
      try {
        await pusher.trigger(`conversation-${conversationId}`, 'new-message', {
          id: result.id,
          content: result.content,
          senderId: result.senderId,
          conversationId: result.conversationId,
          createdAt: result.createdAt,
          sender: result.sender,
          mentionedUserIds,
        });
      } catch (error) {
        console.error('Failed to broadcast message:', error);
        // Don't fail the request if Pusher fails
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
  update: protectedProcedure
    .input(
      z.object({
        messageId: z.string(),
        content: z.string().min(1).max(4000),
        mentionedUserIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { messageId, content, mentionedUserIds = [] } = input;

      // Get the existing message and verify user is the sender
      const existingMessage = await prisma.message.findUnique({
        where: { id: messageId },
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

      if (!existingMessage) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Message not found',
        });
      }

      if (existingMessage.senderId !== userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not the sender of this message',
        });
      }

      // Verify user is still a member of the conversation
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId: existingMessage.conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Verify mentioned users are members of the conversation
      if (mentionedUserIds.length > 0) {
        const mentionedMemberships = await prisma.conversationMember.findMany({
          where: {
            conversationId: existingMessage.conversationId,
            userId: { in: mentionedUserIds },
          },
        });

        if (mentionedMemberships.length !== mentionedUserIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Some mentioned users are not members of this conversation',
          });
        }
      }

      // Update message and mentions in transaction
      const updatedMessage = await prisma.$transaction(async (tx) => {
        // Update the message content
        const message = await tx.message.update({
          where: { id: messageId },
          data: { content },
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

        // Delete existing mentions
        await tx.mention.deleteMany({
          where: { messageId },
        });

        // Create new mentions if any
        if (mentionedUserIds.length > 0) {
          await tx.mention.createMany({
            data: mentionedUserIds.map((mentionedUserId) => ({
              messageId,
              userId: mentionedUserId,
            })),
          });
        }

        return message;
      });

      // Broadcast message update to Pusher
      try {
        await pusher.trigger(`conversation-${existingMessage.conversationId}`, 'message-updated', {
          id: updatedMessage.id,
          content: updatedMessage.content,
          senderId: updatedMessage.senderId,
          conversationId: updatedMessage.conversationId,
          createdAt: updatedMessage.createdAt,
          sender: updatedMessage.sender,
          mentionedUserIds,
        });
      } catch (error) {
        console.error('Failed to broadcast message update:', error);
        // Don't fail the request if Pusher fails
      }

      return {
        id: updatedMessage.id,
        content: updatedMessage.content,
        senderId: updatedMessage.senderId,
        conversationId: updatedMessage.conversationId,
        createdAt: updatedMessage.createdAt,
        sender: updatedMessage.sender,
        mentionedUserIds,
      };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        messageId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { messageId } = input;

      // Get the message and verify user is the sender
      const existingMessage = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!existingMessage) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Message not found',
        });
      }

      if (existingMessage.senderId !== userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not the sender of this message',
        });
      }

      // Verify user is still a member of the conversation
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId: existingMessage.conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Delete message and all related mentions in transaction
      await prisma.$transaction(async (tx) => {
        // Delete mentions first (due to foreign key constraint)
        await tx.mention.deleteMany({
          where: { messageId },
        });

        // Delete the message
        await tx.message.delete({
          where: { id: messageId },
        });
      });

      // Broadcast message deletion to Pusher
      try {
        await pusher.trigger(`conversation-${existingMessage.conversationId}`, 'message-deleted', {
          messageId,
          conversationId: existingMessage.conversationId,
          senderId: existingMessage.senderId,
        });
      } catch (error) {
        console.error('Failed to broadcast message deletion:', error);
        // Don't fail the request if Pusher fails
      }

      return {
        success: true,
        messageId,
      };
    }),
  markAsRead: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      // Verify user is a member of the conversation and update lastViewedAt
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Update the user's lastViewedAt timestamp for this conversation
      await prisma.conversationMember.update({
        where: {
          id: membership.id,
        },
        data: {
          lastViewedAt: new Date(),
        },
      });

      // Broadcast that user has viewed the conversation
      try {
        await pusher.trigger(`conversation-${conversationId}`, 'conversation-viewed', {
          userId,
          viewedAt: new Date(),
        });
      } catch (error) {
        console.error('Failed to broadcast conversation view:', error);
        // Don't fail the request if Pusher fails
      }

      return { success: true };
    }),

  markMentionsAsRead: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      // Verify user is a member of the conversation and update lastViewedMentionAt
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Update the user's lastViewedMentionAt timestamp for this conversation
      await prisma.conversationMember.update({
        where: {
          id: membership.id,
        },
        data: {
          lastViewedMentionAt: new Date(),
        },
      });

      // Broadcast that user has viewed mentions
      try {
        await pusher.trigger(`conversation-${conversationId}`, 'mentions-viewed', {
          userId,
          viewedAt: new Date(),
        });
      } catch (error) {
        console.error('Failed to broadcast mentions view:', error);
        // Don't fail the request if Pusher fails
      }

      return { success: true };
    }),

  getUnreadCount: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      // Get user's membership with lastViewedAt and lastViewedMentionAt
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Count regular unread messages
      const unreadCount = await prisma.message.count({
        where: {
          conversationId,
          senderId: { not: userId },
          ...(membership.lastViewedAt && {
            createdAt: { gt: membership.lastViewedAt }
          }),
        },
      });

      // Count unread mentions
      // Use the later of lastViewedAt or lastViewedMentionAt
      // This means if user viewed conversation after mention, mention is considered read
      const mentionCutoffTime = membership.lastViewedMentionAt && membership.lastViewedAt 
        ? (membership.lastViewedMentionAt > membership.lastViewedAt ? membership.lastViewedMentionAt : membership.lastViewedAt)
        : (membership.lastViewedMentionAt || membership.lastViewedAt);
      
      const unreadMentionCount = await prisma.mention.count({
        where: {
          userId,
          message: {
            conversationId,
            senderId: { not: userId },
            ...(mentionCutoffTime && {
              createdAt: { gt: mentionCutoffTime }
            }),
          },
        },
      });

      return { 
        unreadCount, 
        unreadMentionCount 
      };
    }),
});

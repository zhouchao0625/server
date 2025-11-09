import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { TRPCError } from '@trpc/server';

export const conversationRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user!.id;

    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      include: {
        labChat: {
          select: {
            id: true,
            title: true,
          },
        },
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
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Calculate unread counts for each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conversation) => {
        const userMembership = conversation.members.find(m => m.userId === userId);
        const lastViewedAt = userMembership?.lastViewedAt;
        const lastViewedMentionAt = userMembership?.lastViewedMentionAt;
        
        // Count regular unread messages
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            ...(lastViewedAt && {
              createdAt: { gt: lastViewedAt }
            }),
          },
        });

        // Count unread mentions
        // Use the later of lastViewedAt or lastViewedMentionAt
        // This means if user viewed conversation after mention, mention is considered read
        const mentionCutoffTime = lastViewedMentionAt && lastViewedAt 
          ? (lastViewedMentionAt > lastViewedAt ? lastViewedMentionAt : lastViewedAt)
          : (lastViewedMentionAt || lastViewedAt);
        
        const unreadMentionCount = await prisma.mention.count({
          where: {
            userId,
            message: {
              conversationId: conversation.id,
              senderId: { not: userId },
              ...(mentionCutoffTime && {
                createdAt: { gt: mentionCutoffTime }
              }),
            },
          },
        });

        return {
          id: conversation.id,
          type: conversation.type,
          name: conversation.name,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          labChat: conversation.labChat,
          members: conversation.members,
          lastMessage: conversation.messages[0] || null,
          unreadCount,
          unreadMentionCount,
        };
      })
    );

    return conversationsWithUnread;
  }),

  create: protectedProcedure
    .input(
      z.object({
        type: z.enum(['DM', 'GROUP']),
        name: z.string().optional(),
        memberIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { type, name, memberIds } = input;

      // Validate input
      if (type === 'GROUP' && !name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Group conversations must have a name',
        });
      }

      if (type === 'DM' && memberIds.length !== 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'DM conversations must have exactly one other member',
        });
      }

      // For DMs, check if conversation already exists
      if (type === 'DM') {
        const existingDM = await prisma.conversation.findFirst({
          where: {
            type: 'DM',
            members: {
              every: {
                userId: {
                  in: [userId, memberIds[0]],
                },
              },
            },
            AND: {
              members: {
                some: {
                  userId,
                },
              },
            },
          },
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
        });

        if (existingDM) {
          return existingDM;
        }
      }

      // Verify all members exist
      const members = await prisma.user.findMany({
        where: {
          username: {
            in: memberIds,
          },
        },
        select: {
          id: true,
          username: true,
        },
      });

      if (members.length !== memberIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more members not found',
        });
      }

      // Create conversation with members
      const conversation = await prisma.conversation.create({
        data: {
          type,
          name,
          members: {
            create: [
              {
                userId,
                role: type === 'GROUP' ? 'ADMIN' : 'MEMBER',
              },
              ...memberIds.map((memberId) => ({
                userId: members.find((member) => member.username === memberId)!.id,
                role: 'MEMBER' as const,
              })),
            ],
          },
        },
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
      });

      return conversation;
    }),

  get: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          members: {
            some: {
              userId,
            },
          },
        },
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
      });

      if (!conversation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Conversation not found or access denied',
        });
      }

      return conversation;
    }),
});

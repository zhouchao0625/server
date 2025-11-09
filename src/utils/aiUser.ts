import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';

const AI_USER_ID = 'AI_ASSISTANT';

/**
 * Ensure AI assistant user exists in the database
 */
export async function ensureAIUserExists(): Promise<void> {
  try {
    // Check if AI user already exists
    const existingAIUser = await prisma.user.findUnique({
      where: { id: AI_USER_ID },
    });

    if (existingAIUser) {
      return; // AI user already exists
    }

    // Create AI user
    await prisma.user.create({
      data: {
        id: AI_USER_ID,
        username: 'ai-assistant',
        email: 'ai@studious-lms.com',
        password: 'ai-system-user', // Not used for login
        verified: true,
        role: 'NONE', // Special role for AI
        profile: {
          create: {
            displayName: 'AI Assistant',
            bio: 'Intelligent assistant for lab chats and educational support',
            profilePicture: null,
          },
        },
      },
    });

    logger.info('AI user created successfully', { userId: AI_USER_ID });

  } catch (error) {
    // If user already exists (race condition), that's okay
    if (error instanceof Error && error.message.includes('unique constraint')) {
      logger.info('AI user already exists (race condition handled)');
      return;
    }

    logger.error('Failed to create AI user', { error });
    throw error;
  }
}

/**
 * Get the AI user ID
 */
export function getAIUserId(): string {
  return AI_USER_ID;
}

/**
 * Check if a user ID belongs to the AI assistant
 */
export function isAIUser(userId: string): boolean {
  return userId === AI_USER_ID;
}

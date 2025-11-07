import OpenAI from 'openai';
import { logger } from './logger.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { ensureAIUserExists, getAIUserId } from './aiUser.js';

// Initialize inference client (Cohere via OpenAI SDK)

logger.info('Inference API Key', { apiKey: process.env.INFERENCE_API_KEY });
logger.info('Inference API Base URL', { baseURL: process.env.INFERENCE_API_BASE_URL });

export const inferenceClient = new OpenAI({
  apiKey: process.env.INFERENCE_API_KEY,
  baseURL: process.env.INFERENCE_API_BASE_URL,
});

// Types for lab chat context
export interface LabChatContext {
  subject: string;
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  objectives: string[];
  resources?: string[];
  persona: string;
  constraints: string[];
  examples?: any[];
  metadata?: Record<string, any>;
}

export interface InferenceResponse {
  content: string;
  model: string;
  tokensUsed: number;
  finishReason: string;
}

/**
 * Centralized function to send AI messages to conversations
 * Handles database storage and Pusher broadcasting
 */
export async function sendAIMessage(
  content: string,
  conversationId: string,
  options: {
    subject?: string;
    attachments?: {
      connect: { id: string }[];
    };
    customSender?: {
      displayName: string;
      profilePicture?: string | null;
    };
  } = {}
): Promise<{
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: Date;
}> {
  // Ensure AI user exists
  await ensureAIUserExists();

  // Create message in database
  const aiMessage = await prisma.message.create({
    data: {
      content,
      senderId: getAIUserId(),
      conversationId,
      ...(options.attachments && {
        attachments: {
          connect: options.attachments.connect,
        },
      }),
    },
    include: {
      attachments: true,
    },
  });

  logger.info('AI Message sent', {
    messageId: aiMessage.id,
    conversationId,
    contentLength: content.length,
  });

  // Prepare sender info
  const senderInfo = {
    id: getAIUserId(),
    username: 'Newton_AI',
    profile: {
      displayName: "Newton AI",
      profilePicture: options.customSender?.profilePicture || null,
    },
  };

  // Broadcast via Pusher
  try {
    await pusher.trigger(`conversation-${conversationId}`, 'new-message', {
      id: aiMessage.id,
      content: aiMessage.content,
      senderId: getAIUserId(),
      conversationId: aiMessage.conversationId,
      createdAt: aiMessage.createdAt,
      sender: senderInfo,
      mentionedUserIds: [],
      attachments: aiMessage.attachments.map(attachment => ({
        id: attachment.id,
        attachmentId: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        path: attachment.path,
      })),
    });
  } catch (error) {
    logger.error('Failed to broadcast AI message:', { error, messageId: aiMessage.id });
  }

  return {
    id: aiMessage.id,
    content: aiMessage.content,
    senderId: getAIUserId(),
    conversationId: aiMessage.conversationId,
    createdAt: aiMessage.createdAt,
  };
}

/**
 * Simple inference function for general use
 */
export async function generateInferenceResponse(
  subject: string,
  question: string,
  options: {
    model?: string;
    maxTokens?: number;
  } = {}
): Promise<InferenceResponse> {
  const { model = 'command-r-plus', maxTokens = 500 } = options;

  try {
    const completion = await inferenceClient.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a helpful educational assistant for ${subject}. Provide clear, concise, and accurate answers. Keep responses educational and appropriate for students.`,
        },
        {
          role: 'user',
          content: question,
        },
      ],
      max_tokens: maxTokens,
      temperature: 0.5,
      // Remove OpenAI-specific parameters for Cohere compatibility
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response generated from inference API');
    }

    return {
      content: response,
      model,
      tokensUsed: completion.usage?.total_tokens || 0,
      finishReason: completion.choices[0]?.finish_reason || 'unknown',
    };

  } catch (error) {
    logger.error('Failed to generate inference response', { error, subject, question: question.substring(0, 50) + '...' });
    throw error;
  }
}

/**
 * Validate inference configuration
 */
export function validateInferenceConfig(): boolean {
  if (!process.env.INFERENCE_API_KEY) {
    logger.error('Inference API key not configured for Cohere');
    return false;
  }
  return true;
}

/**
 * Get available inference models (for admin/config purposes)
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    const models = await inferenceClient.models.list();
    return models.data
      .filter(model => model.id.includes('command'))
      .map(model => model.id)
      .sort();
  } catch (error) {
    logger.error('Failed to fetch inference models', { error });
    return ['command-r-plus', 'command-r', 'command-light']; // Fallback Cohere models
  }
}

/**
 * Estimate token count for a message (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}
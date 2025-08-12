import { initTRPC, TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { logger } from './utils/logger';
import { prisma } from './lib/prisma';
import { createLoggingMiddleware } from './middleware/logging';
import { createAuthMiddleware } from './middleware/auth';
import { Request, Response } from 'express';
import { z } from 'zod';

interface CreateContextOptions {
  req: Request;
  res: Response;
}

export type Context = {
  req: Request;
  res: Response;
  user: { id: string } | null;
  meta?: {
    classId?: string;
    institutionId?: string;
  };
};

export const createTRPCContext = async (opts: CreateContextOptions): Promise<Context> => {
  const { req, res } = opts;
  
  // Get user from session/token
  const token = req.headers.authorization?.split(' ')[1];
  const user = token ? await prisma.user.findFirst({
    where: {
      sessions: {
        some: {
          id: token
        }
      },
    },
    select: {
      id: true,
    }
  }) : null;
  
  return {
    req,
    res,
    user,
    meta: {},
  };
};

export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    logger.error('tRPC Error', {
      code: shape.code,
      message: error.message,
      cause: error.cause,
      stack: error.stack,
    });

    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// Create middleware
const loggingMiddleware = createLoggingMiddleware(t);
const { isAuthed, isMemberInClass, isTeacherInClass } = createAuthMiddleware(t);

// Base procedures
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure.use(loggingMiddleware);

// Protected procedures
export const protectedProcedure = publicProcedure.use(isAuthed);
export const protectedClassMemberProcedure = protectedProcedure
  .input(z.object({ classId: z.string() }).passthrough())
  .use(isMemberInClass);
export const protectedTeacherProcedure = protectedProcedure
  .input(z.object({ classId: z.string() }).passthrough())
  .use(isTeacherInClass);


// Create caller factory
export const createCallerFactory = t.createCallerFactory; 
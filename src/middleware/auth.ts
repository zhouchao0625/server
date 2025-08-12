import { TRPCError } from '@trpc/server';
import { prisma } from '../lib/prisma';
import type { MiddlewareContext } from '../types/trpc';

export const createAuthMiddleware = (t: any) => {

  // Auth middleware
  const isAuthed = t.middleware(async ({ next, ctx }: MiddlewareContext) => {
    const startTime = Date.now();
    // Get user from request headers
    const userHeader = ctx.req.headers['x-user'];

    if (!userHeader) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated - no token found',
      });
    }

    try {
      const token = typeof userHeader === 'string' ? userHeader : userHeader[0];

      // Find user by session token
      const user = await prisma.user.findFirst({
        where: {
          sessions: {
            some: {
              id: token
            }
          }
        },
        select: {
          id: true,
          username: true,
          // institutionId: true,
        }
      });

      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
        });
      }

      console.log(user)

      return next({
        ctx: {
          ...ctx,
          user,
        },
      });
    } catch (error) {
      console.log(error)
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Invalid user data',
      });
    }
  });

  // Add computed flags middleware
  const addComputedFlags = t.middleware(async ({ next, ctx }: MiddlewareContext) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    }

    // Get all classes where user is a teacher
    const teacherClasses = await prisma.class.findMany({
      where: {
        teachers: {
          some: {
            id: ctx.user.id
          }
        }
      },
      select: {
        id: true
      }
    });

    return next({
      ctx: {
        ...ctx,
        isTeacher: teacherClasses.length > 0,
        teacherClassIds: teacherClasses.map((c: { id: string }) => c.id)
      }
    });
  });

  // Student middleware
  const isMemberInClass = t.middleware(async ({ next, ctx, input }: MiddlewareContext) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    }

    const classId = (input as { classId: string })?.classId;

    if (!classId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'classId is required',
      });
    }

    const isMember = await prisma.class.findFirst({
      where: {
        id: classId,
        OR: [
          {
            students: {
              some: {
                id: ctx.user.id
              }
            }
          },
          {
            teachers: {
              some: {
                id: ctx.user.id
              }
            }
          }
        ]
      }
    });

    if (!isMember) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not a member in this class',
      });
    }

    return next();
  });

  // Teacher middleware
  const isTeacherInClass = t.middleware(async ({ next, ctx, input }: MiddlewareContext) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Not authenticated',
      });
    }

    const classId = input.classId;
    if (!classId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'classId is required',
      });
    }

    const isTeacher = await prisma.class.findFirst({
      where: {
        id: classId,
        teachers: {
          some: {
            id: ctx.user.id
          }
        }
      }
    });



    if (!isTeacher) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not a teacher in this class',
      });
    }

    return next();
  });

  return {
    isAuthed,
    addComputedFlags,
    isMemberInClass,
    isTeacherInClass,
  };
}; 
import { execSync } from 'child_process';
import { config } from 'dotenv';
import { resolve } from 'path';
import { prisma } from '../src/lib/prisma';
import { beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { logger } from '../src/utils/logger';
import { appRouter } from '../src/routers/_app';
import { createTRPCContext } from '../src/trpc';
import { Session } from '@prisma/client';
import { clearDatabase } from '../src/seedDatabase';

// Load test environment variables
config({ path: resolve(process.cwd(), '.env.test') });

const getCaller = async (token: string) => {
  const ctx = await createTRPCContext({
    req: { headers: {
      authorization: token ? `Bearer ${token}` : undefined,
      'x-user': token || undefined,
    } } as any,
    res: {} as any,
  });
  return appRouter.createCaller(ctx);
};

// Before the entire test suite runs
beforeAll(async () => {
  try {
    logger.info('DATABASE_URL: ' + process.env.DATABASE_URL);
    await clearDatabase();
    logger.info('Database cleared for tests');

    // Create public caller (no auth) for registration
    caller = await getCaller('');

    // Register users
    const user1 = await caller.auth.register({
      username: 'testuser1',
      email: 'test@test.com',
      password: 'password_is_1234',
      confirmPassword: 'password_is_1234',
    });

    const user2 = await caller.auth.register({
      username: 'testuser2',
      email: 'test2@test.com',
      password: 'password_is_1234',
      confirmPassword: 'password_is_1234',
    });

    const user3 = await caller.auth.register({
      username: 'testuser3',
      email: 'test3@test.com',
      password: 'password_is_1234',
      confirmPassword: 'password_is_1234',
    });

    // Get sessions created during registration
    session1 = await prisma.session.findFirst({
      where: {
        userId: user1.user.id,
      },
    }) as Session;

    session2 = await prisma.session.findFirst({
      where: {
        userId: user2.user.id,
      },
    }) as Session;

    session3 = await prisma.session.findFirst({ 
      where: {
        userId: user3.user.id,
      },
    }) as Session;

    if (!session1 || !session2 || !session3) {
      throw new Error('Failed to create sessions for test users');
    }

    // Verify emails using session tokens
    verification1 = await caller.auth.verify({
      token: session1.id,
    });

    verification2 = await caller.auth.verify({
      token: session2.id,
    });

    verification3 = await caller.auth.verify({
      token: session3.id,
    });

    // Login to get fresh tokens
    login1 = await caller.auth.login({
      username: 'testuser1',
      password: 'password_is_1234',
    });

    login2 = await caller.auth.login({
      username: 'testuser2',
      password: 'password_is_1234',
    });

    login3 = await caller.auth.login({
      username: 'testuser3',
      password: 'password_is_1234',
    });

    if (!login1.token || !login2.token || !login3.token) {
      throw new Error('Failed to get login tokens');
    }

    // Create authenticated callers
    user1Caller = await getCaller(login1.token);
    user2Caller = await getCaller(login2.token);
    user3Caller = await getCaller(login3.token);
    logger.info('Test setup completed successfully');
  } catch (error) {
    logger.error('Test setup failed', { error });
    throw error;
  }
});

// After all tests, close the DB
afterAll(async () => {
  try {
    await prisma.$disconnect();
  } catch (error) {
    logger.error('Error disconnecting from database', { error });
  }
});

export let user1Caller: ReturnType<typeof appRouter.createCaller>;
export let user2Caller: ReturnType<typeof appRouter.createCaller>;
export let user3Caller: ReturnType<typeof appRouter.createCaller>;
export let caller: ReturnType<typeof appRouter.createCaller>;
export let session1: Session;
export let session2: Session;
export let session3: Session;
export let verification1: any;
export let verification2: any;
export let verification3: any;
export let login1: any;
export let login2: any;
export let login3: any;
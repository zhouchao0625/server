import { execSync } from 'child_process';
import { prisma } from '../src/lib/prisma';
import { beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { logger } from '../src/utils/logger';
import { appRouter } from '../src/routers/_app';
import { createTRPCContext } from '../src/trpc';
import { Session } from '@prisma/client';
import { clearDatabase } from '../src/seedDatabase';

const getCaller = async (token: string) => {
  const ctx = await createTRPCContext({
    req: { headers: {
      authorization: `Bearer ${token}`,
      'x-user': token,
    } } as any,
    res: {} as any,
  });
  return appRouter.createCaller(ctx);
};

  // Before the entire test suite runs
  beforeAll(async () => {

    await clearDatabase();

    logger.info('Getting caller');

    caller = await getCaller('');

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

    session1 = await prisma.session.findFirst({
      where: {
        userId: user1.user.id,
      },
    }) as Session;

    session2 = (await prisma.session.findFirst({
      where: {
        userId: user2.user.id,
      },
    })) as Session;

    verification1 = await caller.auth.verify({
      token: session1.id,
    });

    verification2 = await caller.auth.verify({
      token: session2.id,
    });

    login1 = await caller.auth.login({
      username: 'testuser1',
      password: 'password_is_1234',
    });

    login2 = await caller.auth.login({
      username: 'testuser2',
      password: 'password_is_1234',
    });

    user1Caller = await getCaller(login1.token);
    user2Caller = await getCaller(login2.token);
  });


  // After all tests, close the DB
  afterAll(async () => {
    await prisma.$disconnect();
  });

export let user1Caller: ReturnType<typeof appRouter.createCaller>;
export let user2Caller: ReturnType<typeof appRouter.createCaller>;
export let caller: ReturnType<typeof appRouter.createCaller>;
export let session1: Session;
export let session2: Session;
export let verification1: any;
export let verification2: any;
export let login1: any;
export let login2: any;
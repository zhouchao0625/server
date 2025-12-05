import { test, expect, describe } from 'vitest';
import { appRouter } from '../src/routers/_app';
import { createTRPCContext } from '../src/trpc';
import { prisma } from '../src/lib/prisma';
import { caller, login1, login2, login3, session1, session2, session3, user1Caller, user2Caller, user3Caller, verification1, verification2, verification3 } from './setup';

describe('Auth Router', () => {
  test('registration creates sessions', async () => {
    expect(session1).toBeDefined();
    expect(session1.id).toBeDefined();
    expect(session2).toBeDefined();
    expect(session2.id).toBeDefined();
  });

  test('email verification works', async () => {
    expect(verification1).toBeDefined();
    expect(verification2).toBeDefined();
  });

  test('login returns valid tokens', async () => {
    expect(login1).toBeDefined();
    expect(login1.token).toBeDefined();
    expect(login1.user).toBeDefined();
    expect(login2).toBeDefined();
    expect(login2.token).toBeDefined();
    expect(login2.user).toBeDefined();
  });

  test('logout invalidates session', async () => {
    // Use user2Caller for logout test to avoid breaking user1Caller for other tests
    const logout = await user3Caller.auth.logout();
    expect(logout).toBeDefined();
    expect(logout.success).toBe(true);
    
    // Verify session is invalidated by trying to use it
    const invalidCaller = await createTRPCContext({
      req: { headers: {
        authorization: `Bearer ${login3.token}`,
        'x-user': login3.token,
      } } as any,
      res: {} as any,
    });
    const router = appRouter.createCaller(invalidCaller);
    
    // Should fail because session was invalidated
    await expect(router.user.getProfile()).rejects.toThrow();
  });
});
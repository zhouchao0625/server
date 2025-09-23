import { test, expect } from 'vitest';
import { appRouter } from '../src/routers/_app';
import { createTRPCContext } from '../src/trpc';
import { prisma } from '../src/lib/prisma';
import { caller, login1, login2, session1, session2, user1Caller, verification1, verification2 } from './setup';

test('registration', async () => {
    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
});

test('email verification', async () => {
    expect(verification1).toBeDefined();
    expect(verification2).toBeDefined();
});

test('login', async () => {
    expect(login1).toBeDefined();
    expect(login2).toBeDefined();
});

test('logout', async () => {
    const logout = await user1Caller.auth.logout();
    expect(logout).toBeDefined();
});
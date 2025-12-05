import { PrismaClient } from '@prisma/client';
import { env } from './config/env.js';

const getLogLevel = () => {
  switch (env.NODE_ENV) {
    case 'development':
      return ['query', 'error', 'warn'];
    case 'production':
      return ['error'];
    default:
      return ['error'];
  }
}

const prismaClientSingleton = () => {
  // return new PrismaClient({
  //   log: env.NODE_ENV === 'development' 
  //     ? ['query', 'error', 'warn'] 
  //     : ['error'],
  // });
  return new PrismaClient();
};

// Prevent multiple instances of Prisma Client in development
declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
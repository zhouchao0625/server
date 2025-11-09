import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma.js";
import { v4 as uuidv4 } from 'uuid';
import { compare, hash } from "bcryptjs";
import { transport } from "../utils/email.js";
import { prismaWrapper } from "../utils/prismaWrapper.js";

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const { username, email, password } = input;

      // Check if username already exists
      const existingUser = await prismaWrapper.findFirst(
        () => prisma.user.findFirst({
          where: { 
            OR: [
              { username },
              { email }
            ]
          },
          select: {
            id: true,
            username: true,
            email: true,
            verified: true,
          }
        }),
        'checking for existing user during registration'
      );

      if (existingUser && existingUser.verified) {
        if (existingUser.username === username) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Username already exists",
          });
        }
        if (existingUser.email === email) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Email already exists",
          });
        }
      } else if (existingUser && !existingUser.verified) {
        await prismaWrapper.deleteMany(
          () => prisma.session.deleteMany({
            where: { userId: existingUser.id },
          }),
          'deleting existing sessions for unverified user'
        );

        await prismaWrapper.delete(
          () => prisma.user.delete({
            where: { id: existingUser.id },
          }),
          'deleting unverified user'
        );
      }

      // Create new user
      const user = await prismaWrapper.create(
        async () => await prisma.user.create({
          data: {
            username,
            email,
            password: await hash(password, 10),
            profile: {},
            verified: true, // temporary
          },
          select: {
            id: true,
            username: true,
            email: true,
          }
        }),
        'creating new user during registration'
      );

      const verificationToken = await prismaWrapper.create(
        () => prisma.session.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
          },
        }),
        'creating verification token'
      );

      // await transport.sendMail({
      //   from: 'noreply@studious.sh',
      //   to: user.email,
      //   subject: 'Verify your email',
      //   text: `Click the link to verify your email: ${process.env.NEXT_PUBLIC_APP_URL}/verify/${verificationToken.id}`,
      // });

      console.log(`${process.env.NEXT_PUBLIC_APP_URL}/verify/${verificationToken.id}`)

      return {
        user: {
          id: user.id,
          username: user.username,
        },
      };
    }),

  login: publicProcedure
    .input(loginSchema)
    .mutation(async ({ input }) => {
      const { username, password } = input;

      const user = await prisma.user.findFirst({
        where: { username },
        select: {
          id: true,
          username: true,
          password: true,
          email: true,
          verified: true,
        }
      });

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "user doesn't exists.",
        });
      }

      if (!(await compare(password, user.password))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      if (!user.verified) {
        return {
          verified: false,
          user: {
            email: user.email,
          },
        }
      }

      // Create a new session
      const session = await prisma.session.create({
        data: {
          id: uuidv4(),
          userId: user.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
      });

      return {
        token: session.id,
        user: {
          id: user.id,
          username: user.username,
        },
      };
    }),

  logout: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }

      // Delete the current session
      await prisma.session.deleteMany({
        where: { userId: ctx.user.id },
      });

      return { success: true };
    }),


  check: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          username: true,
          profile: {
            select: {
              displayName: true,
              bio: true,
              location: true,
              website: true,
              profilePicture: true,
              profilePictureThumbnail: true,
            },
          },
        }
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return {user};
    }),
    resendVerificationEmail: publicProcedure
      .input(z.object({
        email: z.string().email(),
      }))
      .mutation(async ({ input }) => {
        const { email } = input;

        const user = await prisma.user.findFirst({
          where: { 
            email,
           },
          select: {
            id: true,
            email: true,
            role: true,
            profile: {
              select: {
                displayName: true,
                bio: true,
                location: true,
                website: true,
                profilePicture: true,
            },
            },
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        await prisma.session.deleteMany({
          where: { userId: user?.id },
        });

        const verificationToken = await prisma.session.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
          },
        });
        
        // await transport.sendMail({
        //   from: 'noreply@studious.sh',
        //   to: user.email,
        //   subject: 'Verify your email',
        //   text: `Click the link to verify your email: ${process.env.NEXT_PUBLIC_APP_URL}/verify/${verificationToken.id}`,
        // });

        return { success: true };
      }),
    verify: publicProcedure
      .input(z.object({
        token: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { token } = input;

        const session = await prisma.session.findUnique({
          where: { id: token },
        });

        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Session not found",
          });
        }

        if (session.expiresAt && session.expiresAt < new Date()) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Session expired",
          });
        }

        await prisma.user.update({
          where: { id: session.userId! },
          data: {
            verified: true,
          },
        });

        // Clean up the verification token
        await prisma.session.delete({
          where: { id: token },
        });

        return { success: true };
      }),
}); 
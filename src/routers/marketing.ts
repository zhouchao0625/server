import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { v4 } from "uuid";

export const marketingRouter = createTRPCRouter({
  createSchoolDevelopementProgram: publicProcedure
    .input(z.object({
      name: z.string(),
      type: z.string(),
      address: z.string(),
      city: z.string(),
      country: z.string(),
      numberOfStudents: z.number(),
      numberOfTeachers: z.number(),
      website: z.string().optional(),
      contactName: z.string().optional(),
      contactRole: z.string().optional(),
      contactEmail: z.string().optional(),
      contactPhone: z.string().optional(),
      eligibilityInformation: z.string().optional(),
      whyHelp: z.string().optional(),
      additionalInformation: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { name, type, address, city, country, numberOfStudents, numberOfTeachers, website, contactName, contactRole, contactEmail, contactPhone, eligibilityInformation, whyHelp, additionalInformation } = input;

    const date = new Date();
      
      const id = name.slice(0, 3).toUpperCase() + '-' + date.getFullYear() + '-' + v4().slice(0, 4).toUpperCase();
      const schoolDevelopementProgram = await prisma.schoolDevelopementProgram.create({
        data: {
          id,
          name,
          type,
          address,
          city,
          country,
          numberOfStudents,
          numberOfTeachers,
          website,
          contactName,
          contactRole,
          contactEmail,
          contactPhone,
          eligibilityInformation,
          whyHelp,
          additionalInformation,
        },
      });

      return {
        id: schoolDevelopementProgram.id,
      };
    }),
    searchSchoolDevelopementPrograms: publicProcedure
    .input(z.object({
        id: z.string(),
    }))
    .query(async ({ input }) => {
        const { id } = input;
        const schoolDevelopementProgram = await prisma.schoolDevelopementProgram.findUnique({
            where: {
                id,
            },
        });
        return schoolDevelopementProgram;
    }),
    earlyAccessRequest: publicProcedure
    .input(z.object({
        email: z.string(),
        institutionSize: z.string(),
    }))
    .mutation(async ({ input }) => {
        const { email, institutionSize } = input;
        const earlyAccessRequest = await prisma.earlyAccessRequest.create({
            data: {
                email,
                institutionSize,
            },
        });
        return {
            id: earlyAccessRequest.id,
        };
    }),
});
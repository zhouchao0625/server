import { createTRPCRouter } from "../trpc";
import { classRouter } from "./class";
import { announcementRouter } from "./announcement";
import { assignmentRouter } from "./assignment";
import { userRouter } from "./user";
import { createCallerFactory } from "../trpc";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { sectionRouter } from "./section";
import { attendanceRouter } from "./attendance";
import { eventRouter } from "./event";
import { authRouter } from "./auth";
import { agendaRouter } from "./agenda";
import { fileRouter } from "./file";

export const appRouter = createTRPCRouter({
  class: classRouter,
  announcement: announcementRouter,
  assignment: assignmentRouter,
  user: userRouter,
  section: sectionRouter,
  attendance: attendanceRouter,
  event: eventRouter,
  auth: authRouter,
  agenda: agendaRouter,
  file: fileRouter,
});

// Export type router type definition
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// Export caller
export const createCaller = createCallerFactory(appRouter); 
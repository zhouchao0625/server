import { createTRPCRouter } from "../trpc.js";
import { classRouter } from "./class.js";
import { announcementRouter } from "./announcement.js";
import { assignmentRouter } from "./assignment.js";
import { userRouter } from "./user.js";
import { createCallerFactory } from "../trpc.js";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { sectionRouter } from "./section.js";
import { attendanceRouter } from "./attendance.js";
import { eventRouter } from "./event.js";
import { authRouter } from "./auth.js";
import { agendaRouter } from "./agenda.js";
import { fileRouter } from "./file.js";
import { folderRouter } from "./folder.js";
import { notificationRouter } from "./notifications.js";
import { conversationRouter } from "./conversation.js";
import { messageRouter } from "./message.js";

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
  folder: folderRouter,
  notification: notificationRouter,
  conversation: conversationRouter,
  message: messageRouter,
}); 

// Export type router type definition
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// Export caller
export const createCaller = createCallerFactory(appRouter); 
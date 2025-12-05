import { test, expect, describe, beforeEach } from 'vitest';
import { user1Caller, user2Caller } from './setup';
import { createTRPCContext } from '../src/trpc';
import { appRouter } from '../src/routers/_app';
import { prisma } from '../src/lib/prisma';

describe('Attendance Router', () => {
  let testClass: any;
  let testEvent: any;
  let student1: any;
  let student2: any;

  beforeEach(async () => {
    // Create a test class
    testClass = await user1Caller.class.create({
      name: 'Test Class for Attendance',
      subject: 'Mathematics',
      section: '10th Grade',
    });

    // Add user2 as a student to the class
    await user1Caller.class.addStudent({
      classId: testClass.id,
      studentId: (await user2Caller.user.getProfile()).id,
    });

    // Get student users
    student1 = await user1Caller.user.getProfile();
    student2 = await user2Caller.user.getProfile();

    // Create a test event
    const startTime = new Date();
    startTime.setHours(10, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(11, 0, 0, 0);

    testEvent = await user1Caller.event.create({
      name: 'Test Event for Attendance',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      classId: testClass.id,
    });
  });

  describe('get', () => {
    test('should get attendance for class', async () => {
      const attendance = await user1Caller.attendance.get({
        classId: testClass.id,
      });

      expect(attendance).toBeDefined();
    });

    test('should get attendance for specific event', async () => {
      const attendance = await user1Caller.attendance.get({
        classId: testClass.id,
        eventId: testEvent.event.id,
      });

      expect(attendance).toBeDefined();
    });

    test('should allow students to view attendance', async () => {
      const attendance = await user2Caller.attendance.get({
        classId: testClass.id,
      });

      expect(attendance).toBeDefined();
    });

    test('should fail for non-class members', async () => {
      // Create a new user and class
      const newClass = await user1Caller.class.create({
        name: 'Other Class',
        subject: 'Science',
        section: '11th Grade',
      });

      await expect(user2Caller.attendance.get({
        classId: newClass.id,
      })).rejects.toThrow();
    });
  });

  describe('update', () => {
    test('should update attendance successfully', async () => {
      const result = await user1Caller.attendance.update({
        classId: testClass.id,
        eventId: testEvent.event.id,
        attendance: {
          present: [
            { id: student1.id, username: student1.username },
          ],
          late: [
            { id: student2.id, username: student2.username },
          ],
          absent: [],
        },
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.present).toBeDefined();
      expect(result.late).toBeDefined();
      expect(result.absent).toBeDefined();
      expect(result.present.some((p: any) => p.id === student1.id)).toBe(true);
      expect(result.late.some((l: any) => l.id === student2.id)).toBe(true);

      // Verify attendance was updated
      const attendance = await user1Caller.attendance.get({
        classId: testClass.id,
        eventId: testEvent.event.id,
      });

      const updatedRecord = attendance.find((a: any) => a.event?.id === testEvent.event.id);
      expect(updatedRecord).toBeDefined();
      expect(updatedRecord?.present.some((p: any) => p.id === student1.id)).toBe(true);
      expect(updatedRecord?.late.some((l: any) => l.id === student2.id)).toBe(true);
    });

    test('should update attendance without event', async () => {
      const result = await user1Caller.attendance.update({
        classId: testClass.id,
        attendance: {
          present: [
            { id: student1.id, username: student1.username },
            { id: student2.id, username: student2.username },
          ],
          late: [],
          absent: [],
        },
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.present.length).toBe(2);
    });

    test('should fail for non-teacher', async () => {
      await expect(user2Caller.attendance.update({
        classId: testClass.id,
        attendance: {
          present: [{ id: student1.id, username: student1.username }],
          late: [],
          absent: [],
        },
      })).rejects.toThrow();
    });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);

      await expect(router.attendance.update({
        classId: testClass.id,
        attendance: {
          present: [],
          late: [],
          absent: [],
        },
      })).rejects.toThrow();
    });
  });
});


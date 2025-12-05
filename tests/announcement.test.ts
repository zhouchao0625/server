import { test, expect, describe, beforeEach } from 'vitest';
import { user1Caller, user2Caller } from './setup';
import { createTRPCContext } from '../src/trpc';
import { appRouter } from '../src/routers/_app';

describe('Announcement Router', () => {
  let testClass: any;
  let testAnnouncement: any;

  beforeEach(async () => {
    // Create a test class
    testClass = await user1Caller.class.create({
      name: 'Test Class for Announcements',
      subject: 'Mathematics',
      section: '10th Grade',
    });

    // Create a test announcement
    testAnnouncement = await user1Caller.announcement.create({
      classId: testClass.id,
      remarks: 'This is a test announcement',
    });
  });

  describe('create', () => {
    test('should create announcement successfully', async () => {
      expect(testAnnouncement).toBeDefined();
      expect(testAnnouncement.announcement).toBeDefined();
      expect(testAnnouncement.announcement.remarks).toBe('This is a test announcement');
      expect(testAnnouncement.announcement.teacher.id).toBeDefined();
    });

    test('should create announcement with attachments', async () => {
      const announcement = await user1Caller.announcement.create({
        classId: testClass.id,
        remarks: 'Announcement with attachments',
        files: [
          {
            name: 'test.pdf',
            type: 'application/pdf',
            size: 1024,
          },
        ],
      });

      expect(announcement.announcement).toBeDefined();
      expect(announcement.announcement.attachments).toBeDefined();
    });

    test('should fail to create announcement for class user is not teacher of', async () => {
      await expect(user2Caller.announcement.create({
        classId: testClass.id,
        remarks: 'Unauthorized announcement',
      })).rejects.toThrow();
    });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);

      await expect(router.announcement.create({
        classId: testClass.id,
        remarks: 'Test',
      })).rejects.toThrow();
    });
  });

  describe('getAll', () => {
    test('should get all announcements for class', async () => {
      const result = await user1Caller.announcement.getAll({
        classId: testClass.id,
      });

      expect(result.announcements).toBeDefined();
      expect(Array.isArray(result.announcements)).toBe(true);
      expect(result.announcements.length).toBeGreaterThanOrEqual(1);
      expect(result.announcements.some((a: any) => a.id === testAnnouncement.announcement.id)).toBe(true);
    });

    test('should fail to get announcements for class user is not member of', async () => {
      await expect(user2Caller.announcement.getAll({
        classId: testClass.id,
      })).rejects.toThrow();
    });
  });

  describe('get', () => {
    test('should get single announcement successfully', async () => {
      const announcement = await user1Caller.announcement.get({
        id: testAnnouncement.announcement.id,
        classId: testClass.id,
      });

      expect(announcement.announcement).toBeDefined();
      expect(announcement.announcement.id).toBe(testAnnouncement.announcement.id);
      expect(announcement.announcement.remarks).toBe('This is a test announcement');
    });

    test('should fail to get announcement for class user is not member of', async () => {
      await expect(user2Caller.announcement.get({
        id: testAnnouncement.announcement.id,
        classId: testClass.id,
      })).rejects.toThrow();
    });
  });

  describe('update', () => {
    test('should update announcement successfully', async () => {
      const updated = await user1Caller.announcement.update({
        id: testAnnouncement.announcement.id,
        classId: testClass.id,
        data: {
          remarks: 'Updated announcement remarks',
        },
      });

      expect(updated.announcement.remarks).toBe('Updated announcement remarks');
    });

    test('should fail to update announcement user is not teacher of', async () => {
      await expect(user2Caller.announcement.update({
        id: testAnnouncement.announcement.id,
        classId: testClass.id,
        data: {
          remarks: 'Unauthorized update',
        },
      })).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('should delete announcement successfully', async () => {
      // Create a new announcement to delete
      const newAnnouncement = await user1Caller.announcement.create({
        classId: testClass.id,
        remarks: 'To be deleted',
      });

      const result = await user1Caller.announcement.delete({
        id: newAnnouncement.announcement.id,
        classId: testClass.id,
      });

      expect(result.success).toBe(true);

      // Verify announcement is deleted
      await expect(user1Caller.announcement.get({
        id: newAnnouncement.announcement.id,
        classId: testClass.id,
      })).rejects.toThrow();
    });

    test('should fail to delete announcement user is not teacher of', async () => {
      await expect(user2Caller.announcement.delete({
        id: testAnnouncement.announcement.id,
        classId: testClass.id,
      })).rejects.toThrow();
    });
  });
});


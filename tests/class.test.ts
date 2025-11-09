import { test, expect, describe, beforeEach } from 'vitest';
import { appRouter } from '../src/routers/_app';
import { createTRPCContext } from '../src/trpc';
import { prisma } from '../src/lib/prisma';
import { caller, user1Caller, user2Caller } from './setup';

describe('Class Router', () => {
  let testClass: any;
  let testClass2: any;

  beforeEach(async () => {
    // Create test classes for each test
    testClass = await user1Caller.class.create({
      name: 'Test Class 1',
      subject: 'Mathematics',
      section: '10th Grade',
    });

    testClass2 = await user2Caller.class.create({
      name: 'Test Class 2',
      subject: 'Science',
      section: '11th Grade',
    });
  });

  describe('create', () => {
    test('should create a class successfully', async () => {
      expect(testClass).toBeDefined();
      expect(testClass.name).toBe('Test Class 1');
      expect(testClass.subject).toBe('Mathematics');
      expect(testClass.section).toBe('10th Grade');
    });

    test('should create multiple classes', async () => {
      expect(testClass).toBeDefined();
      expect(testClass2).toBeDefined();
      expect(testClass.id).not.toBe(testClass2.id);
    });

    test('should fail to create class without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);
      
      await expect(router.class.create({
        name: 'Test Class',
        subject: 'Mathematics',
        section: '10th Grade',
      })).rejects.toThrow();
    });

    test('should fail to create class with missing required fields', async () => {
      await expect(user1Caller.class.create({
        name: '',
        subject: 'Mathematics',
        section: '10th Grade',
      })).rejects.toThrow();
    });
  });

  describe('getAll', () => {
    test('should get all classes for authenticated user', async () => {
      const classes = await user1Caller.class.getAll();
      expect(classes).toBeDefined();
      expect(classes.teacherInClass).toBeDefined();
      expect(classes.studentInClass).toBeDefined();
      expect(Array.isArray(classes.teacherInClass)).toBe(true);
      expect(Array.isArray(classes.studentInClass)).toBe(true);
    });

    test('should include user\'s own classes as teacher', async () => {
      const classes = await user1Caller.class.getAll();
      const userClass = classes.teacherInClass.find((c: any) => c.name === 'Test Class 1');
      expect(userClass).toBeDefined();
    });

    test('should fail to get classes without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);
      
      await expect(router.class.getAll()).rejects.toThrow();
    });
  });

  describe('get', () => {
    test('should get class by ID successfully', async () => {
      const classData = await user1Caller.class.get({ classId: testClass.id });
      expect(classData).toBeDefined();
      expect(classData.class).toBeDefined();
      expect(classData.class.id).toBe(testClass.id);
      expect(classData.class.name).toBe('Test Class 1');
    });

    test('should fail to get non-existent class', async () => {
      await expect(user1Caller.class.get({ classId: 'non-existent-id' })).rejects.toThrow();
    });

    test('should fail to get class without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);
      
      await expect(router.class.get({ classId: testClass.id })).rejects.toThrow();
    });
  });

  describe('update', () => {
    test('should update class successfully', async () => {
      const updatedClass = await user1Caller.class.update({
        classId: testClass.id,
        name: 'Updated Test Class',
        subject: 'Physics',
        section: '12th Grade',
      });

      expect(updatedClass).toBeDefined();
      expect(updatedClass.updatedClass).toBeDefined();
      expect(updatedClass.updatedClass.name).toBe('Updated Test Class');
      expect(updatedClass.updatedClass.subject).toBe('Physics');
      expect(updatedClass.updatedClass.section).toBe('12th Grade');
    });

    test('should fail to update class user is not teacher of', async () => {
      await expect(user2Caller.class.update({
        classId: testClass.id,
        name: 'Updated Test Class',
        subject: 'Physics',
        section: '12th Grade',
      })).rejects.toThrow();
    });

    test('should fail to update non-existent class', async () => {
      await expect(user1Caller.class.update({
        classId: 'non-existent-id',
        name: 'Updated Test Class',
        subject: 'Physics',
        section: '12th Grade',
      })).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('should delete class successfully', async () => {
      const result = await user1Caller.class.delete({ classId: testClass.id, id: testClass.id });
      expect(result).toBeDefined();
      expect(result.deletedClass).toBeDefined();
      expect(result.deletedClass.id).toBe(testClass.id);
    });

    test('should fail to delete class user is not teacher of', async () => {
      await expect(user2Caller.class.delete({ classId: testClass.id, id: testClass.id })).rejects.toThrow();
    });

    test('should fail to delete non-existent class', async () => {
      await expect(user1Caller.class.delete({ classId: 'non-existent-id', id: 'non-existent-id' })).rejects.toThrow();
    });
  });

  describe('addStudent', () => {
    test('should add student successfully', async () => {
      const user2Profile = await user2Caller.user.getProfile();
      const result = await user1Caller.class.addStudent({
        classId: testClass.id,
        studentId: user2Profile.id,
      });
      expect(result).toBeDefined();
      expect(result.updatedClass).toBeDefined();
      expect(result.newStudent).toBeDefined();
    });

    test('should fail to add student if user is not class teacher', async () => {
      const user1Profile = await user1Caller.user.getProfile();
      await expect(user2Caller.class.addStudent({
        classId: testClass.id,
        studentId: user1Profile.id,
      })).rejects.toThrow();
    });
  });

  describe('changeRole', () => {
    test('should change user role successfully', async () => {
      const user2Profile = await user2Caller.user.getProfile();
      const result = await user1Caller.class.changeRole({
        classId: testClass.id,
        userId: user2Profile.id,
        type: 'teacher',
      });
      expect(result).toBeDefined();
      expect(result.updatedClass).toBeDefined();
      expect(result.user).toBeDefined();
      expect(result.user.type).toBe('teacher');
    });

    test('should fail to change role if user is not class teacher', async () => {
      const user1Profile = await user1Caller.user.getProfile();
      await expect(user2Caller.class.changeRole({
        classId: testClass.id,
        userId: user1Profile.id,
        type: 'teacher',
      })).rejects.toThrow();
    });
  });

  describe('removeMember', () => {
    test('should remove member successfully', async () => {
      // First add a student
      const user2Profile = await user2Caller.user.getProfile();
      await user1Caller.class.addStudent({
        classId: testClass.id,
        studentId: user2Profile.id,
      });
      
      // Then remove them
      const result = await user1Caller.class.removeMember({
        classId: testClass.id,
        userId: user2Profile.id,
      });
      expect(result).toBeDefined();
      expect(result.updatedClass).toBeDefined();
      expect(result.removedUserId).toBe(user2Profile.id);
    });

    test('should fail to remove member if user is not class teacher', async () => {
      const user1Profile = await user1Caller.user.getProfile();
      await expect(user2Caller.class.removeMember({
        classId: testClass.id,
        userId: user1Profile.id,
      })).rejects.toThrow();
    });
  });

  describe('join', () => {
    test('should join class with class code successfully', async () => {
      // First create an invite code
      const inviteCode = await user1Caller.class.createInviteCode({ classId: testClass.id });
      
      // Then join with the code
      const result = await user2Caller.class.join({ classCode: inviteCode.code });
      expect(result).toBeDefined();
      expect(result.joinedClass).toBeDefined();
      expect(result.joinedClass.id).toBe(testClass.id);
    });

    test('should fail to join with invalid class code', async () => {
      await expect(user2Caller.class.join({ classCode: 'invalid-code' })).rejects.toThrow();
    });
  });

  describe('getInviteCode', () => {
    test('should get invite code successfully', async () => {
      const result = await user1Caller.class.getInviteCode({ classId: testClass.id });
      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe('string');
    });

    test('should fail to get invite code if user is not class teacher', async () => {
      await expect(user2Caller.class.getInviteCode({ classId: testClass.id })).rejects.toThrow();
    });
  });

  describe('createInviteCode', () => {
    test('should create invite code successfully', async () => {
      const result = await user1Caller.class.createInviteCode({ classId: testClass.id });
      expect(result).toBeDefined();
      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe('string');
    });

    test('should fail to create invite code if user is not class teacher', async () => {
      await expect(user2Caller.class.createInviteCode({ classId: testClass.id })).rejects.toThrow();
    });
  });
}); 
import { test, expect, describe, beforeEach } from 'vitest';
import { user1Caller, user2Caller } from './setup';
import { createTRPCContext } from '../src/trpc';
import { appRouter } from '../src/routers/_app';
import { prisma } from '../src/lib/prisma';
import { startOfWeek } from 'date-fns';

describe('Event Router', () => {
  let testClass: any;
  let testEvent: any;

  beforeEach(async () => {
    // Create a test class for user1
    testClass = await user1Caller.class.create({
      name: 'Test Class for Events',
      subject: 'Mathematics',
      section: '10th Grade',
    });

    // Create a test event
    const startTime = new Date();
    startTime.setHours(10, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(11, 0, 0, 0);

    testEvent = await user1Caller.event.create({
      name: 'Test Event',
      location: 'Room 101',
      remarks: 'Test remarks',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      classId: testClass.id,
      color: '#3B82F6',
    });
  });

  describe('create', () => {
    test('should create event successfully', async () => {
      expect(testEvent).toBeDefined();
      expect(testEvent.event).toBeDefined();
      expect(testEvent.event.name).toBe('Test Event');
      expect(testEvent.event.location).toBe('Room 101');
      expect(testEvent.event.remarks).toBe('Test remarks');
      expect(testEvent.event.classId).toBe(testClass.id);
      expect(testEvent.event.color).toBe('#3B82F6');
    });

    test('should create event without class', async () => {
      const startTime = new Date();
      startTime.setHours(14, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(15, 0, 0, 0);

      const event = await user1Caller.event.create({
        name: 'Personal Event',
        location: 'Home',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      expect(event.event).toBeDefined();
      expect(event.event.name).toBe('Personal Event');
      expect(event.event.classId).toBeNull();
    });

    test('should fail to create event for class user is not teacher of', async () => {
      const startTime = new Date();
      startTime.setHours(10, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(11, 0, 0, 0);

      await expect(user2Caller.event.create({
        name: 'Unauthorized Event',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        classId: testClass.id,
      })).rejects.toThrow();
    });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);

      const startTime = new Date();
      await expect(router.event.create({
        name: 'Test',
        startTime: startTime.toISOString(),
        endTime: startTime.toISOString(),
      })).rejects.toThrow();
    });
  });

  describe('get', () => {
    test('should get event successfully', async () => {
      const event = await user1Caller.event.get({
        id: testEvent.event.id,
      });

      expect(event).toBeDefined();
      expect(event.event.id).toBe(testEvent.event.id);
      expect(event.event.name).toBe('Test Event');
      expect(event.event.class).toBeDefined();
    });

    test('should fail to get event user does not own', async () => {
      await expect(user2Caller.event.get({
        id: testEvent.event.id,
      })).rejects.toThrow();
    });

    test('should fail to get non-existent event', async () => {
      await expect(user1Caller.event.get({
        id: 'non-existent-id',
      })).rejects.toThrow();
    });
  });

  describe('update', () => {
    test('should update event successfully', async () => {
      const startTime = new Date();
      startTime.setHours(12, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(13, 0, 0, 0);

      const updated = await user1Caller.event.update({
        id: testEvent.event.id,
        data: {
          name: 'Updated Event Name',
          location: 'Room 202',
          remarks: 'Updated remarks',
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          color: '#10B981',
        },
      });

      expect(updated.event.name).toBe('Updated Event Name');
      expect(updated.event.location).toBe('Room 202');
      expect(updated.event.remarks).toBe('Updated remarks');
      expect(updated.event.color).toBe('#10B981');
    });

    // @todo: not implemented partial updates
    // test('should update event with partial data', async () => {
    //   const updated = await user1Caller.event.update({
    //     id: testEvent.event.id,
    //     data: {
    //       name: 'Partially Updated Event',
    //     },
    //   });

    //   expect(updated.event.name).toBe('Partially Updated Event');
    //   expect(updated.event.location).toBe('Room 101'); // Should remain unchanged
    // });

    test('should fail to update event user does not own', async () => {
      await expect(user2Caller.event.update({
        id: testEvent.event.id,
        data: {
          name: 'Unauthorized Update',
          location: 'Room 101',
          remarks: 'Updated remarks',
          startTime: testEvent.event.startTime,
          endTime: testEvent.event.endTime,
          color: '#10B981',
        },
      })).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('should delete event successfully', async () => {
      const result = await user1Caller.event.delete({
        id: testEvent.event.id,
      });

      expect(result.success).toBe(true);

      // Verify event is deleted
      await expect(user1Caller.event.get({
        id: testEvent.event.id,
      })).rejects.toThrow();
    });

    test('should fail to delete event user does not own', async () => {
      await expect(user2Caller.event.delete({
        id: testEvent.event.id,
      })).rejects.toThrow();
    });
  });

  describe('getAll', () => {
    test('should get all events for user', async () => {
      // Create another event
      const startTime = new Date();
      startTime.setHours(15, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(16, 0, 0, 0);

      const secondEvent = await user1Caller.event.create({
        name: 'Second Event',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      const events = await user1Caller.agenda.get({
        weekStart: startOfWeek(startTime).toISOString(),
      });

      expect(events.events).toBeDefined();
      expect(events.events.personal.length).toBeGreaterThanOrEqual(2);
      expect(events.events.personal.some((e) => e.id === secondEvent.event.id)).toBe(true);
    });

    test('should return empty array for user with no events', async () => {
      const events = await user2Caller.agenda.get({
        weekStart: new Date().toISOString(),
      });
      expect(events.events.personal).toBeDefined();
      expect(Array.isArray(events.events.personal)).toBe(true);
      expect(events.events.personal.length).toBe(0);
    });
  });
});


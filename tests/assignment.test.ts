import { test, expect, describe, beforeEach } from 'vitest';
import { user1Caller, user2Caller } from './setup';
import { createTRPCContext } from '../src/trpc';
import { appRouter } from '../src/routers/_app';

describe('Assignment Router', () => {
  let testClass: any;
  let testAssignment: any;
  let studentId: string;

  beforeEach(async () => {
    // Create a test class
    testClass = await user1Caller.class.create({
      name: 'Test Class for Assignments',
      subject: 'Mathematics',
      section: '10th Grade',
    });

    // Add user2 as a student
    const studentProfile = await user2Caller.user.getProfile();
    studentId = studentProfile.id;
    await user1Caller.class.addStudent({
      classId: testClass.id,
      studentId: studentId,
    });

    // Create a test assignment
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7); // Due in 7 days

    testAssignment = await user1Caller.assignment.create({
      classId: testClass.id,
      title: 'Test Assignment',
      instructions: 'Complete this test assignment',
      dueDate: dueDate.toISOString(),
      maxGrade: 100,
      type: 'HOMEWORK',
    });
  });

  describe('create', () => {
    test('should create assignment successfully', async () => {
      expect(testAssignment).toBeDefined();
      expect(testAssignment).toBeDefined();
      expect(testAssignment.title).toBe('Test Assignment');
      expect(testAssignment.instructions).toBe('Complete this test assignment');
      expect(testAssignment.maxGrade).toBe(100);
      expect(testAssignment.type).toBe('HOMEWORK');
    });

    test('should create assignment with different types', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const quiz = await user1Caller.assignment.create({
        classId: testClass.id,
        title: 'Test Quiz',
        instructions: 'Complete this quiz',
        dueDate: dueDate.toISOString(),
        type: 'QUIZ',
        maxGrade: 50,
      });

      expect(quiz.type).toBe('QUIZ');
      expect(quiz.maxGrade).toBe(50);
    });

    test('should create assignment with files', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const assignment = await user1Caller.assignment.create({
        classId: testClass.id,
        title: 'Assignment with Files',
        instructions: 'Submit with files',
        dueDate: dueDate.toISOString(),
        acceptFiles: true,
        files: [
          {
            name: 'test.pdf',
            type: 'application/pdf',
            size: 1024,
          },
        ],
      });

      expect(assignment).toBeDefined();
    });

    test('should fail to create assignment for class user is not teacher of', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      await expect(user2Caller.assignment.create({
        classId: testClass.id,
        title: 'Unauthorized Assignment',
        instructions: 'Test',
        dueDate: dueDate.toISOString(),
      })).rejects.toThrow();
    });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);

      const dueDate = new Date();
      await expect(router.assignment.create({
        classId: testClass.id,
        title: 'Test',
        instructions: 'Test',
        dueDate: dueDate.toISOString(),
      })).rejects.toThrow();
    });
  });

  describe('get', () => {
    test('should get assignment successfully', async () => {
      const assignment = await user1Caller.assignment.get({
        id: testAssignment.id,
        classId: testClass.id,
      });

      expect(assignment).toBeDefined();
      expect(assignment.id).toBe(testAssignment.id);
      expect(assignment.title).toBe('Test Assignment');
    });

    test('should allow students to get assignment', async () => {
      const assignment = await user2Caller.assignment.get({
        id: testAssignment.id,
        classId: testClass.id,
      });

      expect(assignment).toBeDefined();
    });

    test('should fail to get assignment for non-class members', async () => {
      const newClass = await user1Caller.class.create({
        name: 'Other Class',
        subject: 'Science',
        section: '11th Grade',
      });

      await expect(user2Caller.assignment.get({
        id: testAssignment.id,
        classId: newClass.id,
      })).rejects.toThrow();
    });
  });

  // describe('getAll', () => {
  //   test('should get all assignments for class', async () => {
  //     const result = await user1Caller.assignment.get({
  //       classId: testClass.id,
  //     });

  //     expect(result).toBeDefined();
  //     expect(Array.isArray(result)).toBe(true);
  //     expect(result.length).toBeGreaterThanOrEqual(1);
  //     expect(result.some((a: any) => a.id === testAssignment.id)).toBe(true);
  //   });

  //   test('should allow students to get all assignments', async () => {
  //     const result = await user2Caller.assignment.({
  //       classId: testClass.id,
  //     });

  //     expect(result.assignments).toBeDefined();
  //   });
  // });

  describe('update', () => {
    test('should update assignment successfully', async () => {
      const updated = await user1Caller.assignment.update({
        classId: testClass.id,
        id: testAssignment.id,
        title: 'Updated Assignment Title',
        instructions: 'Updated instructions',
      });

      expect(updated.title).toBe('Updated Assignment Title');
      expect(updated.instructions).toBe('Updated instructions');
    });

    test('should update assignment with partial data', async () => {
      const updated = await user1Caller.assignment.update({
        classId: testClass.id,
        id: testAssignment.id,
        title: 'Partially Updated Title',
      });

      expect(updated.title).toBe('Partially Updated Title');
      expect(updated.instructions).toBe('Complete this test assignment'); // Should remain unchanged
    });

    test('should fail to update assignment user is not teacher of', async () => {
      await expect(user2Caller.assignment.update({
        classId: testClass.id,
        id: testAssignment.id,
        title: 'Unauthorized Update',
      })).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('should delete assignment successfully', async () => {
      // Create a new assignment to delete
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const newAssignment = await user1Caller.assignment.create({
        classId: testClass.id,
        title: 'To Be Deleted',
        instructions: 'This will be deleted',
        dueDate: dueDate.toISOString(),
      });

      const result = await user1Caller.assignment.delete({
        id: newAssignment.id,
        classId: testClass.id,
      });

      expect(result.id).toBe(newAssignment.id);

      // Verify assignment is deleted
      await expect(user1Caller.assignment.get({
        id: newAssignment.id,
        classId: testClass.id,
      })).rejects.toThrow();
    });

    test('should fail to delete assignment user is not teacher of', async () => {
      await expect(user2Caller.assignment.delete({
        id: testAssignment.id,
        classId: testClass.id,
      })).rejects.toThrow();
    });
  });

  describe('submit', () => {
    test('should automatically create submission successfully', async () => {
      // First create a submission
      const submission = await user2Caller.assignment.getSubmission({
        classId: testClass.id,
        assignmentId: testAssignment.id,
      });

      expect(submission).toBeDefined();
    });

    test('should submit assignment with extended response', async () => {

      const submission = await user2Caller.assignment.getSubmission({
        classId: testClass.id,
        assignmentId: testAssignment.id,
      });

      const updatedSubmission = await user2Caller.assignment.updateSubmission({
        classId: testClass.id,
        assignmentId: testAssignment.id,
        submissionId: submission.id,
        extendedResponse: 'This is my answer to the assignment',
      });

      expect(updatedSubmission.extendedResponse).toBe('This is my answer to the assignment');
    });

    test('should fail to submit assignment for non-class members', async () => {
      const newClass = await user1Caller.class.create({
        name: 'Other Class',
        subject: 'Science',
        section: '11th Grade',
      });

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const newAssignment = await user1Caller.assignment.create({
        classId: newClass.id,
        title: 'Other Assignment',
        instructions: 'Test',
        dueDate: dueDate.toISOString(),
      });

      await expect(user2Caller.assignment.getSubmission({
        assignmentId: newAssignment.id,
        classId: newClass.id,
        submit: true,
      })).rejects.toThrow();
    });
  });
});


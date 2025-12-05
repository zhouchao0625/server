import { test, expect, describe, beforeEach } from 'vitest';
import { user1Caller, user2Caller } from './setup';
import { createTRPCContext } from '../src/trpc';
import { appRouter } from '../src/routers/_app';

describe('User Router', () => {
  describe('getProfile', () => {
    test('should get user profile successfully', async () => {
      const profile = await user1Caller.user.getProfile();
      
      expect(profile).toBeDefined();
      expect(profile.id).toBeDefined();
      expect(profile.username).toBe('testuser1');
      expect(profile.profile).toBeDefined();
      expect(profile.profile.displayName).toBeNull();
      expect(profile.profile.bio).toBeNull();
      expect(profile.profile.location).toBeNull();
      expect(profile.profile.website).toBeNull();
      expect(profile.profile.profilePicture).toBeNull();
    });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);
      
      await expect(router.user.getProfile()).rejects.toThrow();
    });
  });

  describe('updateProfile', () => {
    test('should update profile with display name and bio', async () => {
      const updated = await user1Caller.user.updateProfile({
        profile: {
          displayName: 'Test User One',
          bio: 'This is a test bio',
          location: 'Test City',
          website: 'https://example.com',
        },
      });

      expect(updated).toBeDefined();
      expect(updated.profile.displayName).toBe('Test User One');
      expect(updated.profile.bio).toBe('This is a test bio');
      expect(updated.profile.location).toBe('Test City');
      expect(updated.profile.website).toBe('https://example.com');
    });

    test('should update profile with partial data', async () => {
      const updated = await user2Caller.user.updateProfile({
        profile: {
          displayName: 'Test User Two',
        },
      });

      expect(updated.profile.displayName).toBe('Test User Two');
    });

    test('should update profile with DiceBear avatar', async () => {
      const updated = await user1Caller.user.updateProfile({
        dicebearAvatar: {
          url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=test',
        },
      });

      expect(updated.profile.profilePicture).toBe('https://api.dicebear.com/7.x/avataaars/svg?seed=test');
    });

    // test('should clear profile fields when set to null', async () => {
    //   // First set some values
    //   await user1Caller.user.updateProfile({
    //     profile: {
    //       displayName: 'Test Name',
    //       bio: 'Test Bio',
    //     },
    //   });

    //   // Then clear them
    //   const cleared = await user1Caller.user.updateProfile({
    //     profile: {
    //       displayName: null,
    //       bio: null,
    //     },
    //   });

    //   expect(cleared.profile.displayName).toBeNull();
    //   expect(cleared.profile.bio).toBeNull();
    // });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);
      
      await expect(router.user.updateProfile({
        profile: { displayName: 'Test' },
      })).rejects.toThrow();
    });
  });

  describe('getUploadUrl', () => {
    test('should generate upload URL for valid image file', async () => {
      const result = await user1Caller.user.getUploadUrl({
        fileName: 'profile.jpg',
        fileType: 'image/jpeg',
      });

      expect(result).toBeDefined();
      expect(result.uploadUrl).toBeDefined();
      expect(result.filePath).toBeDefined();
      expect(result.fileName).toBeDefined();
      expect(result.filePath).toContain('users/');
      expect(result.filePath).toContain('/profile/');
    });

    test('should generate upload URL for PNG file', async () => {
      const result = await user1Caller.user.getUploadUrl({
        fileName: 'avatar.png',
        fileType: 'image/png',
      });

      expect(result).toBeDefined();
      expect(result.fileName).toContain('.png');
    });

    test('should fail for invalid file type', async () => {
      await expect(user1Caller.user.getUploadUrl({
        fileName: 'document.pdf',
        fileType: 'application/pdf',
      })).rejects.toThrow();
    });

    test('should fail for empty file name', async () => {
      await expect(user1Caller.user.getUploadUrl({
        fileName: '',
        fileType: 'image/jpeg',
      })).rejects.toThrow();
    });

    test('should fail without authentication', async () => {
      const invalidCaller = await createTRPCContext({
        req: { headers: {} } as any,
        res: {} as any,
      });
      const router = appRouter.createCaller(invalidCaller);
      
      await expect(router.user.getUploadUrl({
        fileName: 'test.jpg',
        fileType: 'image/jpeg',
      })).rejects.toThrow();
    });
  });
});


# Easy LMS API Specification

## Overview

Easy LMS is a comprehensive Learning Management System built with tRPC, Prisma, and PostgreSQL. This document provides a complete API specification for frontend developers.

### Base URL
- **Development**: `http://localhost:3001/trpc`
- **Production**: `https://your-domain.com/trpc`

### Authentication
- **Method**: Bearer Token Authentication
- **Header**: `Authorization: Bearer <token>`
- **Session Management**: Token-based sessions with expiration

---

## 🔐 Authentication Endpoints

### `auth.register`
**Type**: Mutation  
**Access**: Public  
**Description**: Register a new user account

**Input**:
```typescript
{
  username: string;     // min 3 characters
  email: string;        // valid email format
  password: string;     // min 6 characters
  confirmPassword: string;
}
```

**Output**:
```typescript
{
  user: {
    id: string;
    username: string;
  };
}
```

### `auth.login`
**Type**: Mutation  
**Access**: Public  
**Description**: Login with username and password

**Input**:
```typescript
{
  username: string;
  password: string;
}
```

**Output**:
```typescript
{
  token: string;
  user: {
    id: string;
    username: string;
  };
  verified?: boolean;
}
```

### `auth.logout`
**Type**: Mutation  
**Access**: Public  
**Description**: Logout and invalidate session

**Output**:
```typescript
{
  success: boolean;
}
```

### `auth.check`
**Type**: Query  
**Access**: Protected  
**Description**: Verify current authentication status

**Output**:
```typescript
{
  user: {
    id: string;
    username: string;
  };
}
```

### `auth.verify`
**Type**: Mutation  
**Access**: Public  
**Description**: Verify email with token

**Input**:
```typescript
{
  token: string;
}
```

### `auth.resendVerificationEmail`
**Type**: Mutation  
**Access**: Public  
**Description**: Resend verification email

**Input**:
```typescript
{
  email: string;
}
```

---

## 👤 User Management

### `user.getProfile`
**Type**: Query  
**Access**: Protected  
**Description**: Get current user profile

**Output**:
```typescript
{
  id: string;
  username: string;
  profile: Record<string, any>;
}
```

### `user.updateProfile`
**Type**: Mutation  
**Access**: Protected  
**Description**: Update user profile

**Input**:
```typescript
{
  profile: Record<string, any>;
  profilePicture?: {
    name: string;
    type: string;
    size: number;
    data: string; // base64
  };
}
```

---

## 🏫 Class Management

### `class.getAll`
**Type**: Query  
**Access**: Protected  
**Description**: Get all classes for current user

**Output**:
```typescript
{
  teacherInClass: Array<{
    id: string;
    name: string;
    section: string;
    subject: string;
    color?: string;
    dueToday: Assignment[];
    assignments: Assignment[];
  }>;
  studentInClass: Array<{
    id: string;
    name: string;
    section: string;
    subject: string;
    color?: string;
    dueToday: Assignment[];
    assignments: Assignment[];
  }>;
}
```

### `class.get`
**Type**: Query  
**Access**: Protected  
**Description**: Get specific class details

**Input**:
```typescript
{
  classId: string;
}
```

**Output**:
```typescript
{
  class: {
    id: string;
    name: string;
    subject: string;
    section: string;
    color?: string;
    teachers: Array<{
      id: string;
      username: string;
    }>;
    students: Array<{
      id: string;
      username: string;
    }>;
    announcements: Array<{
      id: string;
      remarks: string;
      createdAt: Date;
      teacher: {
        id: string;
        username: string;
      };
    }>;
    assignments: Assignment[];
    sections: Section[];
  };
}
```

### `class.create`
**Type**: Mutation  
**Access**: Protected  
**Description**: Create a new class

**Input**:
```typescript
{
  name: string;
  section: string;
  subject: string;
  color?: string;
  students?: string[];
  teachers?: string[];
}
```

### `class.update`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update class details

**Input**:
```typescript
{
  classId: string;
  name?: string;
  section?: string;
  subject?: string;
}
```

### `class.delete`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Delete a class

**Input**:
```typescript
{
  classId: string;
  id: string;
}
```

### `class.join`
**Type**: Mutation  
**Access**: Protected  
**Description**: Join class with invite code

**Input**:
```typescript
{
  classCode: string;
}
```

### `class.getInviteCode`
**Type**: Query  
**Access**: Teacher Only  
**Description**: Get class invite code

**Input**:
```typescript
{
  classId: string;
}
```

**Output**:
```typescript
{
  code: string;
}
```

### `class.addStudent`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Add student to class

**Input**:
```typescript
{
  classId: string;
  studentId: string;
}
```

### `class.changeRole`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Change user role in class

**Input**:
```typescript
{
  classId: string;
  userId: string;
  type: 'teacher' | 'student';
}
```

### `class.removeMember`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Remove member from class

**Input**:
```typescript
{
  classId: string;
  userId: string;
}
```

---

## 📝 Assignment Management

### `assignment.create`
**Type**: Mutation  
**Access**: Protected  
**Description**: Create a new assignment

**Input**:
```typescript
{
  classId: string;
  title: string;
  instructions: string;
  dueDate: string;
  files?: File[];
  existingFileIds?: string[];
  maxGrade?: number;
  graded?: boolean;
  weight?: number;
  sectionId?: string;
  type?: 'HOMEWORK' | 'QUIZ' | 'TEST' | 'PROJECT' | 'ESSAY' | 'DISCUSSION' | 'PRESENTATION' | 'LAB' | 'OTHER';
  markSchemeId?: string;
  gradingBoundaryId?: string;
  inProgress?: boolean;
}
```

### `assignment.update`
**Type**: Mutation  
**Access**: Protected  
**Description**: Update assignment

**Input**:
```typescript
{
  classId: string;
  id: string;
  title?: string;
  instructions?: string;
  dueDate?: string;
  files?: File[];
  existingFileIds?: string[];
  removedAttachments?: string[];
  maxGrade?: number;
  graded?: boolean;
  weight?: number;
  sectionId?: string | null;
  type?: AssignmentType;
  inProgress?: boolean;
}
```

### `assignment.delete`
**Type**: Mutation  
**Access**: Protected  
**Description**: Delete assignment

**Input**:
```typescript
{
  id: string;
  classId: string;
}
```

### `assignment.get`
**Type**: Query  
**Access**: Protected  
**Description**: Get assignment details

**Input**:
```typescript
{
  id: string;
  classId: string;
}
```

### `assignment.getSubmission`
**Type**: Query  
**Access**: Class Member  
**Description**: Get student's submission for assignment

**Input**:
```typescript
{
  assignmentId: string;
  classId: string;
}
```

### `assignment.getSubmissions`
**Type**: Query  
**Access**: Teacher Only  
**Description**: Get all submissions for assignment

**Input**:
```typescript
{
  assignmentId: string;
  classId: string;
}
```

### `assignment.updateSubmission`
**Type**: Mutation  
**Access**: Class Member  
**Description**: Update student submission

**Input**:
```typescript
{
  assignmentId: string;
  classId: string;
  submissionId: string;
  submit?: boolean;
  newAttachments?: File[];
  existingFileIds?: string[];
  removedAttachments?: string[];
}
```

### `assignment.updateSubmissionAsTeacher`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update submission as teacher (grading)

**Input**:
```typescript
{
  assignmentId: string;
  classId: string;
  submissionId: string;
  return?: boolean;
  gradeReceived?: number | null;
  newAttachments?: File[];
  existingFileIds?: string[];
  removedAttachments?: string[];
  rubricGrades?: Array<{
    criteriaId: string;
    selectedLevelId: string;
    points: number;
    comments: string;
  }>;
}
```

---

## 📢 Announcements

### `announcement.getAll`
**Type**: Query  
**Access**: Class Member  
**Description**: Get all class announcements

**Input**:
```typescript
{
  classId: string;
}
```

**Output**:
```typescript
{
  announcements: Array<{
    id: string;
    remarks: string;
    createdAt: Date;
    teacher: {
      id: string;
      username: string;
    };
  }>;
}
```

### `announcement.create`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Create new announcement

**Input**:
```typescript
{
  classId: string;
  remarks: string;
}
```

### `announcement.update`
**Type**: Mutation  
**Access**: Protected  
**Description**: Update announcement

**Input**:
```typescript
{
  id: string;
  data: {
    content: string;
  };
}
```

### `announcement.delete`
**Type**: Mutation  
**Access**: Protected  
**Description**: Delete announcement

**Input**:
```typescript
{
  id: string;
}
```

---

## 📁 Folder Management

### `folder.create`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Create a new folder in a class

**Input**:
```typescript
{
  classId: string;
  name: string;
  parentFolderId?: string;
}
```

### `folder.get`
**Type**: Query  
**Access**: Class Member  
**Description**: Get folder details and contents

**Input**:
```typescript
{
  classId: string;
  folderId: string;
}
```

### `folder.getChildFolders`
**Type**: Query  
**Access**: Class Member  
**Description**: Get child folders of a folder

**Input**:
```typescript
{
  classId: string;
  folderId: string;
}
```

### `folder.getFolderChildren`
**Type**: Query  
**Access**: Class Member  
**Description**: Get all children (files and folders) of a folder

**Input**:
```typescript
{
  classId: string;
  folderId: string;
}
```

### `folder.getRootFolder`
**Type**: Query  
**Access**: Class Member  
**Description**: Get root folder for a class

**Input**:
```typescript
{
  classId: string;
}
```

### `folder.uploadFiles`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Upload files to a folder

**Input**:
```typescript
{
  classId: string;
  folderId: string;
  files: File[];
}
```

### `folder.delete`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Delete a folder

**Input**:
```typescript
{
  classId: string;
  folderId: string;
}
```

### `folder.move`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Move folder to different parent

**Input**:
```typescript
{
  classId: string;
  folderId: string;
  newParentFolderId: string;
}
```

### `folder.rename`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Rename a folder

**Input**:
```typescript
{
  classId: string;
  folderId: string;
  newName: string;
}
```

---

## 📁 File Management

### `file.getSignedUrl`
**Type**: Mutation  
**Access**: Protected  
**Description**: Get signed URL for file download

**Input**:
```typescript
{
  fileId: string;
}
```

**Output**:
```typescript
{
  url: string;
}
```

### `file.move`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Move file to different folder

**Input**:
```typescript
{
  fileId: string;
  targetFolderId: string;
  classId: string;
}
```

### `file.rename`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Rename file

**Input**:
```typescript
{
  fileId: string;
  newName: string;
  classId: string;
}
```

### `file.delete`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Delete file

**Input**:
```typescript
{
  fileId: string;
  classId: string;
}
```

---

## 📚 Section Management

### `section.create`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Create a new section in a class

**Input**:
```typescript
{
  classId: string;
  name: string;
}
```

**Output**:
```typescript
{
  id: string;
  name: string;
  classId: string;
}
```

### `section.update`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update section name

**Input**:
```typescript
{
  id: string;
  classId: string;
  name: string;
}
```

**Output**:
```typescript
{
  id: string;
  name: string;
  classId: string;
}
```

### `section.delete`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Delete a section

**Input**:
```typescript
{
  id: string;
  classId: string;
}
```

**Output**:
```typescript
{
  id: string;
}
```

---

## 📊 Attendance Management

### `attendance.get`
**Type**: Query  
**Access**: Class Member  
**Description**: Get attendance records for a class

**Input**:
```typescript
{
  classId: string;
  eventId?: string;
}
```

**Output**:
```typescript
Array<{
  id: string;
  date: Date;
  event?: {
    id: string;
    name: string;
    startTime: Date;
    endTime: Date;
    location: string;
    color: string;
  };
  present: Array<{
    id: string;
    username: string;
  }>;
  late: Array<{
    id: string;
    username: string;
  }>;
  absent: Array<{
    id: string;
    username: string;
  }>;
}>
```

### `attendance.update`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update attendance for a class event

**Input**:
```typescript
{
  classId: string;
  eventId?: string;
  attendance: {
    present: Array<{
      id: string;
      username: string;
    }>;
    late: Array<{
      id: string;
      username: string;
    }>;
    absent: Array<{
      id: string;
      username: string;
    }>;
  };
}
```

**Output**:
```typescript
{
  id: string;
  date: Date;
  event?: {
    id: string;
    name: string;
    startTime: Date;
    endTime: Date;
    location: string;
  };
  present: Array<{
    id: string;
    username: string;
  }>;
  late: Array<{
    id: string;
    username: string;
  }>;
  absent: Array<{
    id: string;
    username: string;
  }>;
}
```

---

## 📅 Agenda Management

### `agenda.get`
**Type**: Query  
**Access**: Protected  
**Description**: Get user's weekly agenda with personal and class events

**Input**:
```typescript
{
  weekStart: string; // ISO date string
}
```

**Output**:
```typescript
{
  events: {
    personal: Array<{
      id: string;
      name: string;
      startTime: Date;
      endTime: Date;
      location?: string;
      color?: string;
      class: null;
    }>;
    class: Array<{
      id: string;
      name: string;
      startTime: Date;
      endTime: Date;
      location?: string;
      color?: string;
      class: {
        id: string;
        name: string;
        subject: string;
        section: string;
      };
    }>;
  };
}
```

---

## 🔔 Notifications

### `notification.list`
**Type**: Query  
**Access**: Protected  
**Description**: Get all notifications for user

**Output**:
```typescript
Array<{
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  read: boolean;
  sender?: {
    username: string;
  };
  receiver: {
    username: string;
  };
}>
```

### `notification.get`
**Type**: Query  
**Access**: Protected  
**Description**: Get specific notification

**Input**:
```typescript
{
  id: string;
}
```

### `notification.sendTo`
**Type**: Mutation  
**Access**: Protected  
**Description**: Send notification to user

**Input**:
```typescript
{
  receiverId: string;
  title: string;
  content: string;
}
```

### `notification.sendToMultiple`
**Type**: Mutation  
**Access**: Protected  
**Description**: Send notification to multiple users

**Input**:
```typescript
{
  receiverIds: string[];
  title: string;
  content: string;
}
```

### `notification.markAsRead`
**Type**: Mutation  
**Access**: Protected  
**Description**: Mark notification as read

**Input**:
```typescript
{
  id: string;
}
```

---


## 📊 Grading & Assessment

### `class.getGrades`
**Type**: Query  
**Access**: Class Member  
**Description**: Get grades for a user

**Input**:
```typescript
{
  classId: string;
  userId: string;
}
```

### `class.updateGrade`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update student grade

**Input**:
```typescript
{
  classId: string;
  assignmentId: string;
  submissionId: string;
  gradeReceived: number | null;
}
```

### Mark Schemes

### `class.listMarkSchemes`
**Type**: Query  
**Access**: Teacher Only

### `class.createMarkScheme`
**Type**: Mutation  
**Access**: Teacher Only

### `class.updateMarkScheme`
**Type**: Mutation  
**Access**: Teacher Only

### `class.deleteMarkScheme`
**Type**: Mutation  
**Access**: Teacher Only

### Grading Boundaries

### `class.listGradingBoundaries`
**Type**: Query  
**Access**: Teacher Only

### `class.createGradingBoundary`
**Type**: Mutation  
**Access**: Teacher Only

### `class.updateGradingBoundary`
**Type**: Mutation  
**Access**: Teacher Only

### `class.deleteGradingBoundary`
**Type**: Mutation  
**Access**: Teacher Only

---

## 📅 Calendar & Events

### `class.getEvents`
**Type**: Query  
**Access**: Teacher Only  
**Description**: Get class events

**Input**:
```typescript
{
  classId: string;
}
```

### `assignment.attachToEvent`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Attach assignment to event

**Input**:
```typescript
{
  assignmentId: string;
  eventId: string;
}
```

### `assignment.detachEvent`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Detach assignment from event

**Input**:
```typescript
{
  assignmentId: string;
}
```

### `assignment.getAvailableEvents`
**Type**: Query  
**Access**: Teacher Only  
**Description**: Get available events for assignment

**Input**:
```typescript
{
  assignmentId: string;
}
```

---

## 🔧 Lab Management (Draft System)

### `class.listLabDrafts`
**Type**: Query  
**Access**: Teacher Only  
**Description**: Get lab drafts

**Input**:
```typescript
{
  classId: string;
}
```

### `class.createLabDraft`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Create lab draft

### `class.updateLabDraft`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update lab draft

### `class.deleteLabDraft`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Delete lab draft

### `class.publishLabDraft`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Publish lab draft as assignment

---

## 📄 Syllabus Management

### `class.getSyllabus`
**Type**: Query  
**Access**: Class Member  
**Description**: Get class syllabus

**Input**:
```typescript
{
  classId: string;
}
```

**Output**:
```typescript
{
  syllabus: string;
  gradingBoundaries: GradingBoundary[];
  markSchemes: MarkScheme[];
}
```

### `class.updateSyllabus`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Update class syllabus

**Input**:
```typescript
{
  classId: string;
  contents: string;
}
```

---

## 🗂️ File Organization

### `class.getFiles`
**Type**: Query  
**Access**: Class Member  
**Description**: Get organized files for class

**Input**:
```typescript
{
  classId: string;
}
```

**Output**:
```typescript
Array<{
  id: string;
  title: string;
  teacher: {
    id: string;
    username: string;
  };
  teacherAttachments: File[];
  students: Array<{
    id: string;
    username: string;
    attachments: File[];
    annotations: File[];
  }>;
}>
```

---

## 🌐 Real-time Features

### Socket.IO Events
- **Connection**: `/socket.io/`
- **Events**: Class updates, new assignments, submissions, etc.

---

## 📊 Data Models

### File Object
```typescript
{
  id: string;
  name: string;
  type: string;
  size: number;
  data: string; // base64 encoded
}
```

### Assignment Object
```typescript
{
  id: string;
  title: string;
  instructions: string;
  dueDate: Date;
  maxGrade?: number;
  graded: boolean;
  weight: number;
  type: AssignmentType;
  inProgress: boolean;
  template: boolean;
  attachments: File[];
  submissions: Submission[];
  section?: Section;
  teacher: User;
  class: Class;
  markScheme?: MarkScheme;
  gradingBoundary?: GradingBoundary;
  eventAttached?: Event;
}
```

### User Roles
- `STUDENT`: Can view classes, submit assignments
- `TEACHER`: Can create/manage classes, grade assignments
- `ADMIN`: System administration
- `NONE`: No specific role

### Assignment Types
- `HOMEWORK`
- `QUIZ`
- `TEST`
- `PROJECT`
- `ESSAY`
- `DISCUSSION`
- `PRESENTATION`
- `LAB`
- `OTHER`

---

## 🔒 Access Control

### Public Endpoints
- All `auth.*` endpoints

### Protected Endpoints
- Require valid authentication token
- User must be logged in

### Class Member Endpoints
- Require `classId` parameter
- User must be student or teacher in the class

### Teacher Only Endpoints
- User must be teacher in the specified class
- Full management capabilities

---

## ⚠️ Error Handling

### Common Error Codes
- `UNAUTHORIZED`: Invalid or missing authentication
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource doesn't exist
- `BAD_REQUEST`: Invalid input data
- `CONFLICT`: Resource already exists
- `INTERNAL_SERVER_ERROR`: Server error

### Error Response Format
```typescript
{
  error: {
    code: string;
    message: string;
    data?: {
      zodError?: any;
      prismaError?: any;
    };
  };
}
```

---

## 🚀 Usage Examples

### TypeScript Client Setup
```typescript
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@studious-lms/server';

const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3001/trpc',
      headers() {
        return {
          authorization: `Bearer ${getAuthToken()}`,
        };
      },
    }),
  ],
});
```

### Example API Calls
```typescript
// Login
const loginResult = await trpc.auth.login.mutate({
  username: 'john_doe',
  password: 'password123'
});

// Get classes
const classes = await trpc.class.getAll.query();

// Create assignment
const assignment = await trpc.assignment.create.mutate({
  classId: 'class-id',
  title: 'Math Homework',
  instructions: 'Complete problems 1-10',
  dueDate: '2024-01-15T23:59:59Z',
  maxGrade: 100,
  graded: true
});
```

---

## 📝 Notes for Frontend Developers

1. **File Uploads**: Files are sent as base64 encoded strings in the `data` field
2. **Date Handling**: All dates are ISO 8601 strings
3. **Authentication**: Store JWT token and include in all requests
4. **Real-time Updates**: Use Socket.IO for live updates
5. **Error Handling**: Always handle tRPC errors appropriately
6. **Type Safety**: Use the exported TypeScript types for full type safety

---

*Generated on: September 14, 2025*  
*Version: 1.1.0*  
*Last Updated: September 2025*

## 📋 Changelog

### Version 1.1.0 (September 2025)
- ✅ Added complete Folder Management endpoints (`folder.*`)
- ✅ Added Section Management endpoints (`section.*`)
- ✅ Added Attendance Management endpoints (`attendance.*`)
- ✅ Added Agenda Management endpoints (`agenda.*`)
- ❌ Removed School Management section (not implemented)
- 🔧 Improved API coverage from ~70% to ~95%

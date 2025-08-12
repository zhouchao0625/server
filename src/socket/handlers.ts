import { Socket, Server } from 'socket.io';
import { logger } from '../utils/logger';

export const setupSocketHandlers = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    logger.info('Client connected', { socketId: socket.id });

    socket.on('disconnect', (reason: string) => {
      logger.info('Client disconnected', { socketId: socket.id, reason });
    });

    socket.on('error', (error: Error) => {
      logger.error('Socket error', { socketId: socket.id, error });
    });

    // Class Room Management
    socket.on('create-class', (data: { class: any }) => {
      io.emit('class-created', data.class);
      logger.info('Class created', { class: data.class });
    });

    socket.on('delete-class', (data: { classId: string }) => {
      io.emit('class-deleted', data.classId);
      logger.info('Class deleted', { classId: data.classId });
    });

    socket.on('update-class', (data: { class: any }) => {
      io.emit('class-updated', data.class);
      logger.info('Class updated', { class: data.class });
    });

    socket.on('join-class', (classId: string, callback: (classId: string) => void) => {
      try {
        socket.join(`class-${classId}`);
        logger.info('Client joined class room', { socketId: socket.id, classId });
        
        if (callback) {
          callback(classId);
        } else {
          socket.emit('joined-class', classId);
        }
      } catch (error) {
        logger.error('Error joining class room', { socketId: socket.id, classId, error });
        if (callback) {
          callback(classId);
        }
      }
    });

    // Assignment Events
    socket.on('assignment-create', (data: { classId: string, assignment: any }) => {
      if (data.classId && data.assignment) {
        io.in(`class-${data.classId}`).emit('assignment-created', data.assignment);
        logger.info('Assignment created', { classId: data.classId, assignmentId: data.assignment.id });
      } else {
        logger.error('Invalid assignment data format', { data });
      }
    });

    socket.on('assignment-update', (data: { classId: string, assignment: any }) => {
      io.in(`class-${data.classId}`).emit('assignment-updated', data.assignment);
      logger.info('Assignment updated', { classId: data.classId, assignmentId: data.assignment.id });
    });

    socket.on('assignment-delete', (data: { classId: string, assignmentId: string }) => {
      io.in(`class-${data.classId}`).emit('assignment-deleted', data.assignmentId);
      logger.info('Assignment deleted', { classId: data.classId, assignmentId: data.assignmentId });
    });

    // Submission Events
    socket.on('submission-update', (data: { classId: string, submission: any }) => {
      io.in(`class-${data.classId}`).emit('submission-updated', data.submission);
      logger.info('Submission updated', { classId: data.classId, submissionId: data.submission.id });
    });

    // Announcement Events
    socket.on('new-announcement', (data: { classId: string, announcement: any }) => {
      io.in(`class-${data.classId}`).emit('announcement-created', data.announcement);
      logger.info('New announcement created', { classId: data.classId, announcementId: data.announcement.id });
    });

    // Section Events
    socket.on('section-create', (data: { classId: string, section: any }) => {
      io.in(`class-${data.classId}`).emit('section-created', data.section);
      logger.info('Section created', { classId: data.classId, sectionId: data.section.id });
    });

    socket.on('section-update', (data: { classId: string, section: any }) => {
      io.in(`class-${data.classId}`).emit('section-updated', data.section);
      logger.info('Section updated', { classId: data.classId, sectionId: data.section.id });
    });

    socket.on('section-delete', (data: { classId: string, sectionId: string }) => {
      io.in(`class-${data.classId}`).emit('section-deleted', data.sectionId);
      logger.info('Section deleted', { classId: data.classId, sectionId: data.sectionId });
    });

    // Member Events
    socket.on('member-update', (data: { classId: string, member: any }) => {
      io.in(`class-${data.classId}`).emit('member-updated', data.member);
      logger.info('Member updated', { classId: data.classId, memberId: data.member.id });
    });

    socket.on('member-delete', (data: { classId: string, memberId: string }) => {
      io.in(`class-${data.classId}`).emit('member-deleted', data.memberId);
      logger.info('Member deleted', { classId: data.classId, memberId: data.memberId });
    });

    // Attendance Events
    socket.on('attendance-update', (data: { classId: string, attendance: any }) => {
      io.in(`class-${data.classId}`).emit('attendance-updated', data.attendance);
      logger.info('Attendance updated', { classId: data.classId, attendanceId: data.attendance.id });
    });

    // Event Events
    socket.on('event-create', (data: { classId: string, event: any }) => {
      if (data.classId) {
        io.in(`class-${data.classId}`).emit('event-created', data.event);
      } else {
        io.emit('event-created', data.event);
      }
      logger.info('Event created', { classId: data.classId, eventId: data.event.id });
    });

    socket.on('event-update', (data: { classId: string, event: any }) => {
      if (data.classId) {
        io.in(`class-${data.classId}`).emit('event-updated', data.event);
      } else {
        io.emit('event-updated', data.event);
      }
      logger.info('Event updated', { classId: data.classId, eventId: data.event.id });
    });

    socket.on('event-delete', (data: { classId: string, eventId: string }) => {
      if (data.classId) {
        io.in(`class-${data.classId}`).emit('event-deleted', data.eventId);
      } else {
        io.emit('event-deleted', data.eventId);
      }
      logger.info('Event deleted', { classId: data.classId, eventId: data.eventId });
    });
  });
}; 
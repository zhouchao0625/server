import { prisma } from "./lib/prisma.js";
import { hash } from "bcryptjs";
import { logger } from "./utils/logger.js";

export async function clearDatabase() {
    // Delete in order to respect foreign key constraints
    // Delete notifications first (they reference users)
    await prisma.notification.deleteMany();
    
    // Delete other records that reference users
    await prisma.submission.deleteMany();
    await prisma.assignment.deleteMany();
    await prisma.announcement.deleteMany();
    await prisma.event.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.file.deleteMany();
    
    // Delete class-related records
    await prisma.section.deleteMany();
    await prisma.markScheme.deleteMany();
    await prisma.gradingBoundary.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.class.deleteMany();
    
    // Delete user-related records
    await prisma.session.deleteMany();
    await prisma.userProfile.deleteMany();
    
    // Finally delete users and schools
    await prisma.user.deleteMany();
    await prisma.school.deleteMany();
}

export async function createUser(email: string, password: string, username: string) {
    logger.debug("Creating user", { email, username, password });

    const hashedPassword = await hash(password, 10);
    return await prisma.user.create({
        data: { email, password: hashedPassword, username, verified: true },
    });
}

export async function addNotification(userId: string, title: string, content: string) {
    return await prisma.notification.create({
        data: {
            receiverId: userId,
            title,
            content,
        },
    });
}

export const seedDatabase = async () => {
    await clearDatabase();
    logger.info('Cleared database');

    // create two test users
    const teacher1 = await createUser('teacher1@studious.sh', '123456', 'teacher1');
    const student1 = await createUser('student1@studious.sh', '123456', 'student1');

    // create a class
    const class1 = await prisma.class.create({
        data: {
            name: 'Class 1',
            subject: 'Math',
            section: 'A',
            teachers: {
                connect: {
                    id: teacher1.id,
                }
            },
            students: {
                connect: {
                    id: student1.id,
                }
            }
        },
    });

    await addNotification(teacher1.id, 'Welcome to Studious', 'Welcome to Studious');
    await addNotification(student1.id, 'Welcome to Studious', 'Welcome to Studious');
};

(async () => {
    logger.info('Seeding database');
    await seedDatabase();
    logger.info('Database seeded');
})();
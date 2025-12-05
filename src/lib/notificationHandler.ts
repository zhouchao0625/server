import { prisma } from "./prisma.js";

interface notificationData {
    title: string,
    content: string
}

export async function sendNotification(receiver: string, data: notificationData) {
    const notification = await prisma.notification.create({
        data: {
            receiverId: receiver,
            title: data.title,
            content: data.content,
        },
    });
    return notification;
}

export async function sendNotifications(receiverIds: Array<string>, data: notificationData) {
    const notifications = await prisma.notification.createMany({
        data: receiverIds.map(receiverId => ({
            receiverId: receiverId,
            title: data.title,
            content: data.content,
        })),
    });
    return notifications;
}

export async function markRead(id: string, read: boolean = true) {
    const notification = await prisma.notification.update({
        where: {id},
        data: {read: read},
    });
    return notification;
}

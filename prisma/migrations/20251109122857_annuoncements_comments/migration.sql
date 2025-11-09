-- AlterTable
ALTER TABLE "public"."Announcement" ADD COLUMN     "modifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."File" ADD COLUMN     "announcementId" TEXT;

-- CreateTable
CREATE TABLE "public"."AnnouncementComment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" TIMESTAMP(3),

    CONSTRAINT "AnnouncementComment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."File" ADD CONSTRAINT "File_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "public"."Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "public"."Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnnouncementComment" ADD CONSTRAINT "AnnouncementComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "public"."AnnouncementComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "public"."ReactionType" AS ENUM ('THUMBSUP', 'CELEBRATE', 'CARE', 'HEART', 'IDEA', 'HAPPY');

-- CreateTable
CREATE TABLE "public"."Reaction" (
    "id" TEXT NOT NULL,
    "type" "public"."ReactionType" NOT NULL,
    "userId" TEXT NOT NULL,
    "announcementId" TEXT,
    "commentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reaction_announcementId_idx" ON "public"."Reaction"("announcementId");

-- CreateIndex
CREATE INDEX "Reaction_commentId_idx" ON "public"."Reaction"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_userId_announcementId_key" ON "public"."Reaction"("userId", "announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_userId_commentId_key" ON "public"."Reaction"("userId", "commentId");

-- AddForeignKey
ALTER TABLE "public"."Reaction" ADD CONSTRAINT "Reaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reaction" ADD CONSTRAINT "Reaction_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "public"."Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reaction" ADD CONSTRAINT "Reaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "public"."AnnouncementComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

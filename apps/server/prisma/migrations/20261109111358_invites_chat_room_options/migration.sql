-- CreateEnum
CREATE TYPE "invite_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "chat_kind" AS ENUM ('TEXT', 'SYSTEM');

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "bots_allowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chat_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_private" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "join_code" VARCHAR(8);

-- CreateTable
CREATE TABLE "room_invites" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "status" "invite_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(3),

    CONSTRAINT "room_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "chat_kind" NOT NULL,
    "user_id" UUID,
    "sender_nickname" VARCHAR(40),
    "sender_rank" VARCHAR(20),
    "body" VARCHAR(1200) NOT NULL,
    "client_message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_invites_target_user_id_status_idx" ON "room_invites"("target_user_id", "status");

-- CreateIndex
CREATE INDEX "room_invites_room_id_idx" ON "room_invites"("room_id");

-- CreateIndex
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_room_id_seq_key" ON "chat_messages"("room_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_room_id_user_id_client_message_id_key" ON "chat_messages"("room_id", "user_id", "client_message_id");

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 수동 추가
CREATE UNIQUE INDEX "room_invites_one_pending" ON "room_invites" ("room_id", "target_user_id") WHERE "status" = 'PENDING';
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_private_code_check" CHECK (NOT "is_private" OR "join_code" IS NOT NULL);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_kind_check" CHECK (("kind" = 'SYSTEM' AND "user_id" IS NULL) OR ("kind" = 'TEXT'));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_check" CHECK (char_length("body") BETWEEN 1 AND 1200);

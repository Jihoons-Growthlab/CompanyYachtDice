-- CreateEnum
CREATE TYPE "user_kind" AS ENUM ('HUMAN', 'DEV', 'BOT');

-- CreateEnum
CREATE TYPE "room_status" AS ENUM ('WAITING', 'PLAYING', 'CLOSED');

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('ACTIVE', 'FINISHED', 'ABORTED');

-- CreateEnum
CREATE TYPE "play_mode" AS ENUM ('MANUAL', 'AUTO', 'AWAY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kind" "user_kind" NOT NULL DEFAULT 'HUMAN';

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "status" "room_status" NOT NULL DEFAULT 'WAITING',
    "capacity" SMALLINT NOT NULL,
    "turn_time_limit_sec" SMALLINT NOT NULL,
    "owner_id" UUID NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "status" "match_status" NOT NULL DEFAULT 'ACTIVE',
    "ruleset" VARCHAR(20) NOT NULL DEFAULT 'yacht-v1',
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "turn_time_limit_sec" SMALLINT NOT NULL,
    "turn_deadline_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "play_mode" "play_mode" NOT NULL DEFAULT 'MANUAL',
    "consecutive_timeouts" INTEGER NOT NULL DEFAULT 0,
    "auto_turns" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "rank" INTEGER,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("match_id","user_id")
);

-- CreateTable
CREATE TABLE "match_commands" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_commands_pkey" PRIMARY KEY ("match_id","user_id","command_id")
);

-- CreateIndex
CREATE INDEX "rooms_status_created_at_idx" ON "rooms"("status", "created_at");

-- CreateIndex
CREATE INDEX "room_members_user_id_idx" ON "room_members"("user_id");

-- CreateIndex
CREATE INDEX "matches_room_id_idx" ON "matches"("room_id");

-- CreateIndex
CREATE INDEX "matches_status_idx" ON "matches"("status");

-- CreateIndex
CREATE INDEX "match_players_user_id_idx" ON "match_players"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_players_match_id_seat_key" ON "match_players"("match_id", "seat");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_commands" ADD CONSTRAINT "match_commands_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 수동 추가: 범위 제약과 방별 ACTIVE 매치 1개
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_check" CHECK ("capacity" BETWEEN 2 AND 6);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_turn_time_limit_check" CHECK ("turn_time_limit_sec" BETWEEN 3 AND 60);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_name_check" CHECK (char_length(btrim("name")) >= 1);
ALTER TABLE "matches" ADD CONSTRAINT "matches_turn_time_limit_check" CHECK ("turn_time_limit_sec" BETWEEN 3 AND 60);
ALTER TABLE "matches" ADD CONSTRAINT "matches_version_check" CHECK ("version" >= 0);
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_seat_check" CHECK ("seat" BETWEEN 0 AND 5);
CREATE UNIQUE INDEX "matches_one_active_per_room" ON "matches" ("room_id") WHERE "status" = 'ACTIVE';

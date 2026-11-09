-- CreateEnum
CREATE TYPE "ui_mode" AS ENUM ('EXCEL', 'CMD');

-- CreateEnum
CREATE TYPE "ui_scale" AS ENUM ('SMALL', 'NORMAL', 'LARGE');

-- CreateEnum
CREATE TYPE "effect_speed" AS ENUM ('FAST', 'NORMAL', 'SLOW');

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "ui_mode" "ui_mode" NOT NULL DEFAULT 'EXCEL',
    "ui_scale" "ui_scale" NOT NULL DEFAULT 'NORMAL',
    "effect_speed" "effect_speed" NOT NULL DEFAULT 'NORMAL',
    "reduced_motion" BOOLEAN NOT NULL DEFAULT false,
    "dice_animation" BOOLEAN NOT NULL DEFAULT true,
    "turn_notification" BOOLEAN NOT NULL DEFAULT true,
    "sound_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sound_volume" SMALLINT NOT NULL DEFAULT 60,
    "ribbon_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 음량 범위
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_volume_check" CHECK ("sound_volume" BETWEEN 0 AND 100);

-- SPEC 13: suscripciones Web Push y preferencias por miembro.
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_members" ADD COLUMN "notify_assigned" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenant_members" ADD COLUMN "notify_customer_message" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenant_members" ADD COLUMN "notify_send_failed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenant_members" ADD COLUMN "notify_new_ai_conversation" BOOLEAN NOT NULL DEFAULT false;

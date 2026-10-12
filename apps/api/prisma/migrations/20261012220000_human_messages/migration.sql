-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "client_message_id" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "sender_member_id" UUID,
ADD COLUMN     "status_updated_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "event_inbox" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_inbox_channel_id_external_id_key" ON "event_inbox"("channel_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key" ON "messages"("conversation_id", "client_message_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_member_id_fkey" FOREIGN KEY ("sender_member_id") REFERENCES "tenant_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD COLUMN "last_inbound_at" TIMESTAMPTZ(3);

UPDATE "conversations" AS c
SET "last_inbound_at" = m.last_at
FROM (
  SELECT "conversation_id", MAX("created_at") AS last_at
  FROM "messages"
  WHERE "direction" = 'INBOUND'
  GROUP BY "conversation_id"
) AS m
WHERE m."conversation_id" = c."id";

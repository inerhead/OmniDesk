-- SPEC 09: el canal demo usa el adaptador simulado (antes N8N, cuando solo existía ese adaptador).
UPDATE "channels" c
SET "provider" = 'SIMULATED', "updated_at" = CURRENT_TIMESTAMP
FROM "tenants" t
WHERE c."tenant_id" = t."id" AND t."slug" = 'demo' AND c."external_id" = 'demo-whatsapp';

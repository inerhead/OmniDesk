# Observabilidad

> SPEC 11. Métricas Prometheus del API y estado del Outbox en `/health`. No hay Prometheus ni Grafana en el compose todavía: las métricas se consultan con `curl`, y cualquier recolector posterior puede leerlas.

## Consultar las métricas

`GET /api/v1/metrics` devuelve texto Prometheus. Requiere `Authorization: Bearer <METRICS_TOKEN>`:

| Situación | Respuesta |
| --- | --- |
| Sin cabecera o con un token incorrecto | `401` |
| `METRICS_TOKEN` vacío | `404`: el endpoint no existe |
| Desde internet (`https://<dominio>/omnidesk/api/v1/metrics`) | `404` siempre, también con el token: el gateway lo bloquea |

Desde el VPS (ejemplo en dev; para prod, cambia `dev` por `prod`):

```bash
C="docker compose -p omnidesk-dev --env-file /srv/omnidesk/.env.dev -f infra/deploy/docker-compose.prod.yml"
# La imagen no trae curl ni wget: se usa fetch de Node.
$C exec api node -e 'fetch("http://localhost:5001/api/v1/metrics", { headers: { authorization: "Bearer " + process.env.METRICS_TOKEN } }).then((r) => r.text()).then((t) => process.stdout.write(t))'
```

En local, con `METRICS_TOKEN` en `.env`:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:${API_HOST_PORT:-5001}/api/v1/metrics
```

Genera el token con `openssl rand -hex 32` (el API exige al menos 32 caracteres).

## Métricas

Todas llevan el prefijo `omnidesk_`. Ninguna etiqueta contiene ids de empresa, conversación o miembro, ni datos personales.

| Nombre | Tipo | Etiquetas | Qué mide |
| --- | --- | --- | --- |
| `omnidesk_http_request_duration_seconds` | histogram | `method`, `route` (plantilla, p. ej. `/api/v1/conversations/:id`; `unmatched` si no hay ruta), `status_class` (`2xx`…) | Latencia HTTP |
| `omnidesk_outbox_pending_events` | gauge | `type` | Eventos del Outbox sin publicar |
| `omnidesk_outbox_oldest_pending_age_seconds` | gauge | — | Antigüedad del pendiente más antiguo (0 si no hay) |
| `omnidesk_message_send_attempts_total` | counter | `provider`, `result` (`success`/`failure`) | Intentos de envío al proveedor (cada mensaje hace hasta 6: el primero y 5 reintentos) |
| `omnidesk_messages_failed_total` | counter | `provider` | Mensajes salientes que pasan a `FAILED` |
| `omnidesk_delivery_status_updates_total` | counter | `status`, `applied` | Reportes de estado de las integraciones (`applied=false`: repetido o fuera de orden) |
| `omnidesk_integration_requests_total` | counter | `endpoint` (`inbound`/`outbound`/`status`), `result` (`ok`/`rejected`/`unauthorized`/`invalid_signature`) | Tráfico de n8n y el simulador |
| `omnidesk_realtime_connected_sockets` | gauge | — | Sockets de tiempo real aceptados |
| `omnidesk_rate_limit_rejections_total` | counter | `policy` | `429` emitidos (lo alimenta SPEC 10; hasta entonces vale 0) |
| `omnidesk_rate_limit_store_errors_total` | counter | — | Fallos del contador de rate limiting (SPEC 10) |
| `omnidesk_process_*`, `omnidesk_nodejs_*` | varios | — | CPU, memoria, event loop y GC del proceso |

Los dos gauges del Outbox se calculan **al leer** el endpoint, con una consulta sobre el índice parcial de pendientes: no hay consultas periódicas. Los contadores se reinician con cada despliegue; `rate()` e `increase()` lo toleran.

## `/health`

`GET /api/v1/health` es público y lo usa el healthcheck de Docker:

```json
{ "status": "ok", "checks": { "database": "up" }, "version": "v0.3.0", "outbox": "ok", "timestamp": "…" }
```

- `version`: `APP_VERSION` (la etiqueta o el commit que fija `deploy.sh`); `dev` sin ella.
- `outbox`: `lagging` si el evento pendiente más antiguo tiene más de `OUTBOX_LAG_THRESHOLD_SECONDS` (60 por defecto), `unknown` si no se pudo leer.
- El código HTTP depende **solo** de la base de datos: un Outbox atrasado responde `200`. Reiniciar el API no lo arregla y cortaría los sockets.

La página **Estado** de la web muestra la fila "Outbox: Al día / Atrasado" y la versión en el detalle del API.

## Consultas PromQL de ejemplo

```promql
# p95 de latencia por ruta (5 min)
histogram_quantile(0.95, sum by (le, route) (rate(omnidesk_http_request_duration_seconds_bucket[5m])))

# Proporción de intentos de envío fallidos (15 min)
sum(rate(omnidesk_message_send_attempts_total{result="failure"}[15m]))
  / sum(rate(omnidesk_message_send_attempts_total[15m]))

# Mensajes que terminaron en FAILED en la última hora
sum(increase(omnidesk_messages_failed_total[1h]))

# Antigüedad del Outbox
max(omnidesk_outbox_oldest_pending_age_seconds)

# Firmas inválidas de integraciones (posible secreto desactualizado en n8n)
sum(increase(omnidesk_integration_requests_total{result="invalid_signature"}[15m]))
```

## Umbrales sugeridos para futuras alertas

| Señal | Umbral | Qué suele indicar |
| --- | --- | --- |
| `omnidesk_outbox_oldest_pending_age_seconds` | > 60 s durante 5 min | El dispatcher está atrasado o un proveedor no responde |
| Proporción de envíos fallidos | > 20 % en 15 min | Proveedor caído, token de WhatsApp vencido o webhook de n8n roto |
| `omnidesk_messages_failed_total` | > 0 en 15 min | Mensajes que un agente tiene que reintentar |
| p95 de latencia HTTP | > 1 s durante 10 min | Base de datos lenta o el VPS saturado |
| `invalid_signature` | > 10 en 15 min | Secreto HMAC desactualizado en n8n o tráfico ajeno |
| `omnidesk_rate_limit_store_errors_total` | > 0 | El contador de rate limiting falla (deja pasar todo) |

## Fuera de alcance por ahora

Prometheus, Grafana y Alertmanager en el compose; alertas; trazas (OpenTelemetry); métricas de negocio por empresa y de la web; centralización de logs.

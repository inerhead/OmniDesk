# SPEC 11 — Robustez II: métricas Prometheus y health extendido

> **Status:** Approved
> **Depends on:** SPEC 08, SPEC 10
> **Date:** 2026-10-12
> **Objective:** El API expone en `/api/v1/metrics`, protegido por token y bloqueado en el gateway público, métricas Prometheus de latencia HTTP, Outbox, envíos, sockets, integraciones y rate limiting, y `/health` añade el estado del Outbox y la versión, que la página Estado muestra.

## Por qué existe este spec

Con OmniDesk en un VPS (SPEC 08), hoy solo se sabe si "algo va mal" por los logs. Las preguntas operativas no tienen respuesta rápida:

- ¿El Outbox se está atrasando?
- ¿Cuántos envíos fallan?
- ¿Cuánto tarda el API?
- ¿Cuántos agentes están conectados?

Este spec instrumenta el API en formato Prometheus, sin montar todavía Prometheus ni Grafana. Cualquier recolector posterior puede leerlo, y mientras tanto se consulta con `curl`.

## Alcance

**Dentro:**

- **Endpoint** `GET /api/v1/metrics`, en formato de texto Prometheus (`prom-client`):
  - Requiere `Authorization: Bearer <METRICS_TOKEN>`. Sin token o con uno incorrecto, `401`.
  - Si `METRICS_TOKEN` está vacío, el endpoint no se registra y responde `404`.
  - El gateway de producción (`infra/gateway/Caddyfile.prod`) responde `404` a `/omnidesk/api/v1/metrics`. Solo se accede desde el VPS: `docker compose exec api curl localhost:5001/api/v1/metrics` o la red interna de Compose.
  - Sin rate limiting.
- **Métricas:**

  | Nombre | Tipo | Etiquetas | Qué mide |
  | --- | --- | --- | --- |
  | `omnidesk_http_request_duration_seconds` | histogram | `method`, `route` (plantilla), `status_class` (`2xx`…) | Latencia HTTP |
  | `omnidesk_outbox_pending_events` | gauge | `type` | Eventos con `published_at IS NULL` |
  | `omnidesk_outbox_oldest_pending_age_seconds` | gauge | — | Antigüedad del pendiente más antiguo |
  | `omnidesk_message_send_attempts_total` | counter | `provider`, `result` (`success`/`failure`) | Intentos de envío del dispatcher |
  | `omnidesk_messages_failed_total` | counter | `provider` | Mensajes que pasan a `FAILED` |
  | `omnidesk_delivery_status_updates_total` | counter | `status`, `applied` | Reportes por `/status` |
  | `omnidesk_integration_requests_total` | counter | `endpoint` (`inbound`/`outbound`/`status`), `result` (`ok`/`rejected`/`unauthorized`/`invalid_signature`) | Tráfico de n8n |
  | `omnidesk_realtime_connected_sockets` | gauge | — | Sockets conectados |
  | `omnidesk_rate_limit_rejections_total` | counter | `policy` | `429` emitidos |
  | `omnidesk_rate_limit_store_errors_total` | counter | — | Fallos del contador (fallo abierto) |
  | Métricas por defecto de proceso y Node | — | prefijo `omnidesk_` | CPU, memoria, event loop, GC |

  - Los gauges del Outbox se calculan **al leer** el endpoint (`collect()`), con una consulta `GROUP BY type` sobre el índice parcial de pendientes. No hay consulta periódica.
  - Ninguna etiqueta contiene ids de tenant, conversación, miembro ni datos personales, para mantener la cardinalidad acotada.
- **Health extendido** (`GET /api/v1/health`, público como hoy):
  - Añade `version` (`APP_VERSION`) y `outbox: 'ok' | 'lagging' | 'unknown'`.
    - `lagging` si el pendiente más antiguo tiene más de 60 s.
    - `unknown` si la consulta falla.
  - El código HTTP sigue dependiendo solo de `db`. Un Outbox atrasado no hace fallar el healthcheck de Docker.
  - **Web (página Estado):**
    - Nueva fila "Outbox: al día / atrasado" y la versión.
    - El mensaje del header añade "· Outbox: atrasado" cuando aplica.
- **Documentación:**
  - `docs/observabilidad.md`: lista de métricas.
  - Consultas PromQL de ejemplo: p95 de latencia, tasa de fallos de envío y antigüedad del Outbox.
  - Umbrales sugeridos para futuras alertas.
  - Cómo consultar desde el VPS.

**Fuera de alcance (para specs futuros):**

- Prometheus, Grafana o Alertmanager en el compose.
- Alertas (email, Slack, push).
- Trazas distribuidas (OpenTelemetry).
- Métricas de negocio por empresa (conversaciones/día, tiempos de respuesta de agentes).
- Métricas de la web (Web Vitals, errores de cliente).
- Centralización de logs.

## Modelo de datos

No hay cambios en Prisma.

**Contratos** (`packages/contracts/src/health.ts`):

```ts
HealthResponseSchema += {
  version: z.string(),                                   // "v0.1.0" | "abc1234" | "dev"
  outbox: z.enum(['ok', 'lagging', 'unknown']),
}
```

**Puertos** (`shared/application/metrics.port.ts`), para que los casos de uso no dependan de `prom-client`:

```ts
interface Metrics {
  messageSendAttempt(provider: string, result: 'success' | 'failure'): void;
  messageFailed(provider: string): void;
  deliveryStatusUpdate(status: string, applied: boolean): void;
  integrationRequest(endpoint: 'inbound' | 'outbound' | 'status', result: IntegrationResult): void;
  rateLimitRejected(policy: string): void;
  rateLimitStoreError(): void;
}
// Adaptadores: PromMetrics (producción) y NoopMetrics (pruebas).
```

**Variables de entorno:**

```
METRICS_TOKEN=          # ≥ 32 caracteres; vacío = endpoint deshabilitado
OUTBOX_LAG_THRESHOLD_SECONDS=60
```

## Plan de implementación

1. **Módulo `observability`.**
   - Registro de `prom-client` con el prefijo `omnidesk_` y las métricas por defecto.
   - `GET /metrics` con el guard de token.
   - e2e: `401` sin token, `200` con token y `404` sin `METRICS_TOKEN`.
2. **Puerto `Metrics`** con `PromMetrics` y `NoopMetrics`, inyectado globalmente.
3. **Latencia HTTP.** Interceptor que registra el histograma con la ruta de plantilla (`/conversations/:id`), nunca con la URL real. Prueba de que dos ids distintos producen una sola serie.
4. **Outbox y envíos.**
   - Gauges con `collect()`.
   - Contadores en el dispatcher (`DispatchOutboundMessage`) y en `UpdateDeliveryStatus`.
   - Pruebas unitarias con `NoopMetrics` espía.
5. **Integraciones, rate limiting y sockets.**
   - Contadores en `ChannelCredentialGuard` y en los controladores de integración.
   - En `RateLimitGuard` (SPEC 10).
   - Gauge de sockets en `realtime.gateway.ts` (conexión y desconexión).
6. **Health extendido.**
   - `CheckHealth` añade `outbox` y `version`.
   - Contrato y mapper.
   - e2e: insertar un `outbox_event` pendiente con `created_at` de hace 2 min da `outbox: 'lagging'`.
7. **Web.** Página Estado y mensaje del header, con prueba de `to-status-view`.
8. **Gateway de producción.** Bloquear `/omnidesk/api/v1/metrics` en `Caddyfile.prod`, y añadir `METRICS_TOKEN` a las plantillas `.env.*.example`.
9. **Documentación.** `docs/observabilidad.md` y `docs/arquitectura.md` §5 y §14.

## Criterios de aceptación

- [ ] `curl -H "Authorization: Bearer $METRICS_TOKEN" localhost:5001/api/v1/metrics` dentro del contenedor devuelve texto Prometheus con todas las métricas de la tabla.
- [ ] Sin cabecera, responde `401`. Con `METRICS_TOKEN` vacío, `404`.
- [ ] `https://dev.gastromesa.com/omnidesk/api/v1/metrics` responde `404`, incluso con el token correcto.
- [ ] Tras abrir 5 conversaciones distintas en la web, `omnidesk_http_request_duration_seconds_count{route="/api/v1/conversations/:id"}` existe, y no hay series con ids concretos.
- [ ] Con `SIMULATED_PROVIDER_FAILURE_RATE=1` y un mensaje enviado, `omnidesk_message_send_attempts_total{result="failure"}` sube en 5 y `omnidesk_messages_failed_total` en 1.
- [ ] Con dos pestañas abiertas, `omnidesk_realtime_connected_sockets` vale 2. Al cerrar una, vale 1.
- [ ] Una petición de integración con firma inválida incrementa `omnidesk_integration_requests_total{result="invalid_signature"}`.
- [ ] Un `429` de `send-message` incrementa `omnidesk_rate_limit_rejections_total{policy="send-message"}`.
- [ ] Con el dispatcher detenido (evento pendiente de más de 60 s), `/health` responde `200` con `outbox: "lagging"`, y la página Estado muestra "Outbox: atrasado".
- [ ] `/health` incluye `version` igual a la etiqueta desplegada (`v0.x.y`) en dev y prod.
- [ ] Ninguna serie de `/metrics` contiene un uuid, un email ni un teléfono (`grep -E '[0-9a-f]{8}-|@|\+[0-9]{8,}'` sin resultados).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** `/metrics` en formato Prometheus con token, sin Prometheus ni Grafana en este spec. Lo decidió el equipo; es el estándar que cualquier recolector entiende.
- **Sí:** bloquear `/metrics` también en el gateway público. Es doble barrera: aunque el token se filtre, el endpoint no es alcanzable desde internet.
- **Sí:** puerto `Metrics` con adaptador `prom-client`. Mantiene los casos de uso libres de infraestructura, como el resto del backend hexagonal.
- **Sí:** gauges del Outbox calculados al leer. Sin trabajo en segundo plano, siempre exactos y con costo solo cuando alguien consulta.
- **Sí:** etiquetas sin ids ni datos personales. Evita la explosión de cardinalidad y que las métricas se conviertan en un canal de datos personales.
- **Sí:** `outbox: lagging` informa pero no cambia el código HTTP de `/health`. Un atraso no debe hacer que Docker reinicie el API, porque reiniciar no lo arregla y corta los sockets.
- **No:** OpenTelemetry. Es más infraestructura de la que se puede operar hoy; llega si aparecen servicios separados (§13).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La consulta del Outbox en `collect()` es lenta con muchos eventos publicados | Usa el índice parcial `outbox_events_pending` (solo pendientes). La purga de SPEC 12 mantiene la tabla acotada. |
| Ruta de plantilla no resuelta (404) genera series por URL | Las rutas no resueltas se etiquetan `route="unmatched"`. Hay una prueba específica. |
| Contadores reiniciados en cada despliegue | Es el comportamiento estándar de Prometheus (`rate()` lo tolera). Se documenta. |
| `METRICS_TOKEN` débil | `env.ts` exige ≥ 32 caracteres cuando no está vacío. |

## Lo que **no** entra en este spec

- Prometheus, Grafana y alertas.
- OpenTelemetry.
- Métricas de negocio y de la web.
- Centralización de logs.

Cada uno llega en su propio spec.

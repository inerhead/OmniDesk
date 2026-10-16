# Datos: qué se guarda, qué se borra y cuándo

> SPEC 12. Para la operación en el VPS (variables, roles, restauración), ver [despliegue.md](despliegue.md#retención-y-row-level-security-spec-12).

## Retención de conversaciones

Cada empresa decide, como OWNER, en **Ajustes → Empresa → Retención de datos**, cuánto tiempo se conservan sus conversaciones **cerradas**:

| Opción | Efecto |
| --- | --- |
| Indefinidamente (por defecto) | No se borra nada por antigüedad. |
| 90, 180 o 365 días | Se borran las conversaciones cerradas cuyo último mensaje es más antiguo que el plazo. |

Antes de guardar, la pantalla muestra cuántas conversaciones borraría la próxima ejecución y, si son más de cero, pide confirmación.

**El job** corre cada día a las **03:30, hora del servidor**, después del backup de las 03:00. Por cada empresa con plazo:

1. Borra del bucket (MinIO) los archivos adjuntos de esas conversaciones.
2. Borra las conversaciones, con sus mensajes, eventos del historial y adjuntos (en lotes de 500).
3. Borra los contactos que se quedaron sin ninguna conversación, con sus teléfonos.
4. Deja una fila en `deletion_log` (`kind = retention`) con cuántas conversaciones y mensajes borró.

**No se borran nunca por antigüedad:** las conversaciones abiertas (son trabajo pendiente), los contactos que aún tienen alguna conversación, los miembros ni las empresas.

## Borrar un contacto a petición

Derecho de supresión: el OWNER, desde el panel de contacto, usa **Borrar contacto y su historial** y confirma escribiendo el teléfono exacto. Se borran de inmediato:

- El contacto y sus identidades (teléfonos).
- Todas sus conversaciones, abiertas o cerradas, con sus mensajes, eventos y archivos (también en el bucket).

Las pestañas abiertas quitan esas conversaciones de la lista al momento; un chat abierto muestra "Esta conversación fue eliminada". Un envío que estuviera en cola se descarta sin error. Si el cliente vuelve a escribir, empieza un contacto y una conversación nuevos, sin historial.

## Purga técnica

El mismo job borra, en todas las empresas, lo que ya no sirve:

| Tabla | Se borra a los 30 días de… |
| --- | --- |
| `outbox_events` | publicarse (el dispatcher, además, ya limpia cada hora los publicados hace más de 24 h). |
| `event_inbox` | recibirse. |
| `sessions` | expirar o revocarse. |
| `invitations` | aceptarse, revocarse o expirar. |

Además borra los **rechazos de solicitudes de empresa** (`tenant_rejections`, SPEC 18) a los **20 días** de rechazarse. Al rechazar, la empresa en revisión y su membresía se borran al momento: solo queda esa fila, con el nombre, el slug, el contacto (móvil y email) y el motivo, para el aviso del solicitante y la pestaña **Rechazadas** de `/platform`. No lleva `tenant_id` ni RLS: solo la leen los caminos de sistema.

## Borrado de una empresa

Un admin de plataforma borra una empresa desde `/platform` (SPEC 20). Solo una empresa **suspendida**, escribiendo su identificador exacto, y nunca la demo con `DEMO_MODE`. Es irreversible.

Al pedirlo, la empresa queda **en borrado** (`tenants.deletion_requested_at`): sale de `/me` y del selector de todos sus miembros, sus sesiones la sueltan, sus canales cuentan como desconocidos para WhatsApp y n8n, y el dispatcher descarta sus eventos. Después, un job (cada minuto y al pedir un borrado, con el lock `omnidesk:tenant-purge`) borra, en este orden:

1. Las conversaciones, de 200 en 200, con sus mensajes, eventos y adjuntos.
2. Todo el bucket de la empresa: `tenants/<id>/` (adjuntos entrantes, salientes y logo).
3. En una transacción: contactos, canales, credenciales, invitaciones, Outbox, `deletion_log`, miembros, las **cuentas huérfanas** y la fila de la empresa. El identificador queda libre.
4. Las fotos de esas cuentas (`users/<id>/`).

Una cuenta es huérfana si no le queda ninguna empresa activa: una baja en otra empresa no la salva. Se borra con sus sesiones, sus suscripciones push y sus rechazos. La cuenta de un admin de plataforma nunca se borra.

Si un paso falla (por ejemplo, MinIO caído), la empresa sigue en borrado y la siguiente pasada retoma. Queda una constancia en `tenant_deletions`, que se conserva siempre: nombre, identificador, quién lo pidió, cuándo, cuándo terminó, el último error y cuántos miembros, cuentas, conversaciones, mensajes, adjuntos y objetos se borraron. No lleva RLS: solo la leen los caminos de sistema y la pestaña **Borradas** de `/platform`.

## `deletion_log`

Deja constancia de cada borrado **sin datos personales**: empresa, tipo (`contact` o `retention`), quién (el miembro, o vacío en el job), cuándo y cuántas conversaciones y mensajes. No guarda nombres, teléfonos ni contenido.

## Lo que no se borra

- **Backups:** el `pg_dump` diario y el archivo de MinIO conservan lo borrado hasta que rotan, **7 días** después. Un borrado no se propaga a los backups ya hechos.
- **Logs** del API y de Nginx: este job no los toca; rotan según la configuración del servidor.
- **Copias fuera de OmniDesk:** lo que ya recibieron WhatsApp (Meta) o el flujo de IA en n8n sigue sus propias políticas.

## Aislamiento entre empresas

Además de los filtros por `tenant_id` del código, PostgreSQL aplica Row Level Security en las 12 tablas de negocio con `tenant_id` (`tenant_deletions` no lleva: es la constancia de una empresa que ya no existe). El API atiende cada petición de una empresa con un rol sin `BYPASSRLS` y con la empresa fijada en la transacción: aunque una consulta olvide el filtro, la base no devuelve filas de otra empresa.

## Fuera de alcance por ahora

Exportación de datos (portabilidad), retención de conversaciones abiertas o por canal, baja completa de una empresa, anonimización en lugar de borrado y cifrado de columnas.

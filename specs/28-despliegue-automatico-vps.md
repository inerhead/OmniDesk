# SPEC 28 — Despliegue automático en el VPS tras cada versión de `main`

> **Status:** Approved/spec
> **Depends on:** SPEC 25, SPEC 26, SPEC 27
> **Date:** 2026-11-03
> **Objective:** Cuando el pipeline publica un tag nuevo de `main`, un job de GitHub entra por SSH al VPS de OVHcloud con el usuario `ubuntu` y su contraseña y lo despliega solo, con backup previo, rollback automático si falla, un interruptor de pausa y el resultado visible en Actions.

## Por qué existe este spec

Hoy publicar una versión es automático (SPEC 25, 26 y 27): un push verde a `main` crea el tag `vX.Y.Z` y publica en `ghcr.io` las imágenes y el bundle. Desplegarla no lo es: alguien entra por SSH al VPS, hace un backup y ejecuta `/srv/omnidesk/bin/omnidesk-deploy vX.Y.Z`. SPEC 26 y 27 dejaron el despliegue automático para otro spec. Es este.

El usuario quiere que cada versión nueva de `main` llegue sola a prod, sin perder lo que hoy se hace a mano: el backup previo y la posibilidad de volver atrás.

Mecanismo elegido: **GitHub entra por SSH con usuario y contraseña**. Implica:

- **Credencial:** el usuario `ubuntu` del VPS y su contraseña de Linux, guardada como secreto en GitHub. Decisión del usuario.
- **El token `read:packages` del VPS no cambia** (SPEC 26). Es otra credencial: GitHub no lo recibe.
- **Acceso completo:** una contraseña no se puede restringir a «solo desplegar» como una clave con `command=…,restrict`. Quien obtenga el secreto entra al VPS como `ubuntu`, con `sudo` y `docker`. Los límites de este spec (solo tags `vX.Y.Z`, solo avanza) evitan errores del pipeline, no a un atacante.
- **SSH sigue abierto a internet y con contraseñas activas**, como hoy (`ufw allow OpenSSH`, SPEC 25). Las máquinas de GitHub Actions usan muchas IPs que cambian, así que no se puede limitar SSH a «solo GitHub». Mientras exista este mecanismo, no se puede desactivar el login por contraseña.

Lo que ya fijaron otros specs y aquí no se reabre:

- Tags solo sobre commits verdes de `main`; imágenes y bundle inmutables en `ghcr.io` con retención de 10 (SPEC 25, 26 y 27).
- `omnidesk-deploy <tag>` extrae el bundle en `/srv/omnidesk/releases/<tag>/`, ejecuta su `deploy.sh` y apunta `/srv/omnidesk/current` a esa versión (SPEC 27). Solo mueve `current` si `deploy.sh` termina bien.
- Las migraciones solo avanzan, y el rollback con una migración incompatible exige restaurar el backup (SPEC 08).

## Alcance

**Dentro:**

- **Job `deploy` en `.github/workflows/release.yml`**, después de `images` (y en paralelo a `prune`):
  - Solo corre si `images` terminó bien, con el tag de `needs.tag.outputs.version`.
  - Ejecuta `/srv/omnidesk/bin/omnidesk-autodeploy <tag>` por SSH con `sshpass -e` (la contraseña va en la variable `SSHPASS`, nunca en la línea de comandos). Comprueba la huella del servidor con un `known_hosts` fijado y nunca acepta una huella desconocida (`StrictHostKeyChecking=yes`).
  - Permisos mínimos: `contents: read`. Usa cuatro secretos del repo: `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD` y `VPS_KNOWN_HOSTS`.
  - Concurrencia propia (`deploy-prod`, sin cancelar): nunca dos despliegues a la vez.
  - Tiempo máximo de 20 minutos.
  - Lee el resultado de la última línea que imprime el script (`OMNIDESK_RESULTADO=<resultado> en_uso=<tag>`) y lo muestra en Actions:
    - **Verde:** `desplegado`; o `pausado` / `omitido`, con un aviso en el resumen.
    - **Rojo:** cualquier otro resultado, o si no llega la línea (conexión cortada): el resumen dice que se mire `autodeploy.log` en el VPS.
    - El resumen del run dice qué pasó: versión desplegada, pausado, omitido, rollback a la versión anterior, fallo sin cambios, o fallo sin rollback.
  - Si falta algún secreto, el job termina con un aviso y en verde, sin intentar conectarse. Así el pipeline sigue funcionando antes de configurar el acceso. (Los secretos no se pueden usar en un `if:`: se pasan como variables de entorno y se comprueban en un paso.)
  - Se actualiza el comentario de cabecera de `release.yml`, que hoy dice que el workflow no toca el VPS.
- **Script `omnidesk-autodeploy <tag>`** (en el repo: `infra/deploy/omnidesk-autodeploy`; viaja en el bundle de SPEC 27; en el VPS: `/srv/omnidesk/bin/omnidesk-autodeploy`). Hace, en orden:
  1. Rechaza cualquier argumento que no sea exactamente un `vX.Y.Z`.
  2. **Sobrevive a un corte de conexión:** ignora `SIGHUP` y `SIGPIPE` y guarda toda su salida en `/srv/omnidesk/autodeploy/<tag>.out`, además de enviarla a GitHub. Si GitHub corta el job o se cae la conexión, el despliegue (y el rollback, si hace falta) termina igual y deja su línea en el log.
  3. Toma un **cerrojo** (`flock -n` sobre `/srv/omnidesk/deploy.lock`). Si hay otro despliegue en curso, falla sin esperar (`ocupado`). Mantiene el cerrojo abierto y exporta `OMNIDESK_DEPLOY_LOCK_HELD=1` para que el `omnidesk-deploy` que lanza no intente tomarlo otra vez.
  4. Si existe `/srv/omnidesk/autodeploy.paused`, no despliega: resultado `pausado`, código 0.
  5. **Solo avanza:** si el tag no es mayor que la versión de `current` (comparación de versiones, no de texto), no despliega: resultado `omitido`, código 0. Así un run antiguo re-ejecutado no hace un downgrade. Los rollbacks manuales se hacen con `omnidesk-deploy` directamente.
  6. **Backup previo:** si existe `current`, ejecuta `backup now` con el compose de la versión en uso. Después copia el dump de Postgres del día a `<BACKUP_DIR>/pre-deploy/omnidesk-prod-pre-<tag>.dump`, fuera de la rotación diaria (que sustituye el dump del mismo día), y conserva los 3 más recientes. Si el backup falla, no despliega: resultado `fallo_backup`.
  7. Despliega con `omnidesk-deploy <tag>`.
  8. **Rollback automático**, solo si algo cambió: si `omnidesk-deploy` falla y había una versión anterior, mira la imagen del contenedor `api` en marcha.
     - Si sigue siendo la versión anterior y está sana (el fallo fue antes de `up`: bundle, `pull` o `.env`), no hace nada: resultado `fallo_sin_cambios`.
     - Si no, ejecuta `omnidesk-deploy <anterior>`. Si funciona, resultado `rollback`. Si también falla (por ejemplo, por una migración incompatible), resultado `fallo_sin_rollback`: **crea `autodeploy.paused`** para que la siguiente versión no despliegue ni sobrescriba backups, y el mensaje indica restaurar el dump de `pre-deploy/` y la versión a mano.
     - En los tres casos termina con código distinto de 0.
  9. Registra cada ejecución en `/srv/omnidesk/autodeploy.log`, con fecha, tag pedido, resultado y versión final en uso, e imprime como última línea `OMNIDESK_RESULTADO=<resultado> en_uso=<tag>`.
- **`omnidesk-deploy`:** toma el mismo cerrojo (`flock -n` sobre `/srv/omnidesk/deploy.lock`) salvo que reciba `OMNIDESK_DEPLOY_LOCK_HELD=1`. Así un despliegue manual y uno automático no se pisan, y el automático puede llamarlo (también para el rollback) sin bloquearse a sí mismo. No cambia nada más.
- **Interruptor de pausa:**
  - `touch /srv/omnidesk/autodeploy.paused` pausa los despliegues automáticos (por ejemplo, durante un rollback manual o una incidencia). También lo crea el script tras un `fallo_sin_rollback`.
  - `rm /srv/omnidesk/autodeploy.paused` los reanuda. La siguiente versión publicada se desplegará; las publicadas durante la pausa, o rechazadas por `ocupado`, no se despliegan solas (se despliegan a mano o llegan con la siguiente).
- **Bundle:** `Dockerfile.bundle` añade `omnidesk-autodeploy`. Pasan a ser 7 archivos. `omnidesk-deploy` avisa si el `omnidesk-autodeploy` instalado es distinto del del bundle, igual que hace consigo mismo.
- **Documentación** (`docs/despliegue.md` y README):
  - Activar el despliegue automático:
    1. Comprobar que el VPS acepta login SSH por contraseña para `ubuntu`.
    2. Instalar `omnidesk-autodeploy` en el VPS.
    3. Obtener el `known_hosts` del VPS y comprobar la huella contra el propio servidor.
    4. Crear los cuatro secretos en GitHub.
    5. Probar la conexión re-ejecutando el job `deploy` del último run: con la versión ya desplegada debe terminar en `omitido`. Eso valida la contraseña y la huella; el despliegue completo se verifica con el siguiente push a `main`.
  - Cómo pausar y reanudar.
  - Dónde ver el resultado: Actions, `autodeploy.log` y `autodeploy/<tag>.out`.
  - Qué hacer cuando el rollback automático falla (restaurar el dump de `pre-deploy/`, desplegar a mano, quitar la pausa).
  - Cómo rotar la contraseña: cambiarla en el VPS (`passwd`) y actualizar el secreto `VPS_PASSWORD`. Cómo revocar el acceso de GitHub: borrar el secreto y cambiar la contraseña.
  - Actualizar §3 y §4: el despliegue manual queda como alternativa y para los rollbacks.

**Fuera de alcance (para futuros specs):**

- Clave SSH restringida (`command=…,restrict`) en lugar de contraseña, desactivar el login SSH por contraseña o un usuario `deploy` aparte. Decisión del usuario: por ahora no.
- Aprobación manual antes de desplegar (environments de GitHub con revisor).
- Notificaciones por email, Telegram u otro canal.
- Restaurar la base automáticamente en un rollback.
- Despliegue sin caída (blue/green).
- Mover SSH a otro puerto, `fail2ban` o limitar SSH por IP.
- Desplegar a mano desde GitHub una versión concreta (ejecución manual del workflow).
- Otros entornos (dev).

## Modelo de datos

Este spec no introduce estructuras de datos de la aplicación. Añade secretos, archivos en el VPS y un formato de log.

**Secretos del repo** (Settings → Secrets and variables → Actions):

| Secreto | Contenido |
| --- | --- |
| `VPS_HOST` | IP o nombre del VPS |
| `VPS_USER` | `ubuntu` |
| `VPS_PASSWORD` | Contraseña de Linux de `ubuntu` |
| `VPS_KNOWN_HOSTS` | Huella del VPS (salida de `ssh-keyscan`, comprobada a mano contra el propio servidor) |

**En el VPS:**

```text
/srv/omnidesk/
├── bin/omnidesk-deploy           # SPEC 27 (añade el cerrojo)
├── bin/omnidesk-autodeploy       # lo que ejecuta el job de GitHub (nuevo)
├── deploy.lock                   # cerrojo compartido por los dos scripts (nuevo)
├── autodeploy.paused             # si existe, el despliegue automático está pausado (nuevo, opcional)
├── autodeploy.log                # una línea por ejecución (nuevo)
└── autodeploy/<tag>.out          # salida completa de cada ejecución (nuevo)

<BACKUP_DIR>/pre-deploy/omnidesk-prod-pre-<tag>.dump   # backup previo a cada despliegue, conserva 3 (nuevo)
```

**Formato de `autodeploy.log`** (una línea por ejecución, separada por tabuladores):

```text
2026-11-03T18:42:10Z	v0.1.5	desplegado	en_uso=v0.1.5
2026-11-04T09:10:02Z	v0.1.6	rollback	en_uso=v0.1.5	motivo=healthcheck
2026-11-04T11:00:00Z	v0.1.7	pausado	en_uso=v0.1.5
2026-11-04T11:05:00Z	v0.1.4	omitido	en_uso=v0.1.5	motivo=no_avanza
```

Resultados posibles: `desplegado`, `pausado`, `omitido`, `rollback`, `fallo_backup`, `fallo_sin_cambios`, `fallo_sin_rollback`, `ocupado`. Solo `desplegado`, `pausado` y `omitido` terminan con código 0.

## Plan de implementación

1. **`omnidesk-autodeploy`.** Escribir el script con validación del tag, protección contra cortes de conexión, cerrojo, pausa, «solo avanza», backup previo, despliegue, rollback y log. Probarlo con un `docker` y un `omnidesk-deploy` simulados en estos casos: despliegue correcto, tag inválido o con caracteres extra, pausa, tag que no avanza, cerrojo ocupado, fallo del backup, fallo antes de `up` (sin rollback), fallo del despliegue con rollback correcto, fallo del despliegue y del rollback (crea la pausa), y conexión cortada a mitad (`kill -HUP`).
2. **Cerrojo en `omnidesk-deploy`.** Añadir el `flock` con la excepción de `OMNIDESK_DEPLOY_LOCK_HELD`. Probar que dos ejecuciones manuales simultáneas no se pisan y que el automático puede llamarlo, también para el rollback.
3. **Bundle.** Añadir `omnidesk-autodeploy` a `Dockerfile.bundle` y el aviso de versión distinta en `omnidesk-deploy`. Construir el bundle en local y comprobar que contiene los 7 archivos.
4. **Job `deploy`.** Añadirlo a `release.yml` con secretos, `sshpass -e`, `known_hosts`, concurrencia, tiempo máximo, resumen y el aviso si faltan secretos; actualizar el comentario de cabecera. Validar el YAML. Probar el paso de SSH en local contra un contenedor `sshd` con login por contraseña: con la huella correcta conecta y lee el resultado; con otra huella se rechaza.
5. **Documentación.** Guía de activación, pausa, logs, rollback fallido y rotación de la credencial en `docs/despliegue.md`, actualización de §3 y §4, y README.
6. **Fusionar en `main`.** El pipeline publica el tag siguiente. Sin secretos, el job `deploy` avisa y termina en verde. Ese tag se despliega a mano una vez con `omnidesk-deploy`, para que el VPS tenga el bundle con `omnidesk-autodeploy`, y se instalan desde él `omnidesk-deploy` y `omnidesk-autodeploy` en `/srv/omnidesk/bin/`.
7. **Activar en el VPS y en GitHub**, siguiendo la guía: crear los secretos, probar la conexión (`omitido`) y verificar con el siguiente push a `main`.

## Criterios de aceptación

**Pipeline**

- [ ] Tras un push verde a `main`, el job `deploy` corre después de `images` y despliega el tag nuevo: `/api/v1/health` responde esa versión y el job queda en verde.
- [ ] Si `images` falla, `deploy` no corre.
- [ ] Sin alguno de los secretos `VPS_*`, `deploy` termina en verde con un aviso y no intenta conectarse.
- [ ] Con un `VPS_KNOWN_HOSTS` que no coincide con el servidor, la conexión se rechaza y el job queda en rojo.
- [ ] La contraseña no aparece en los logs del job ni en la lista de procesos del runner.
- [ ] El resumen del run dice el resultado: desplegado, pausado, omitido, rollback, fallo sin cambios o fallo sin rollback.
- [ ] Dos pushes seguidos no ejecutan dos despliegues a la vez.

**Credencial**

- [ ] El acceso personal del usuario al VPS sigue funcionando igual.
- [ ] El token `read:packages` del VPS no se copia a GitHub ni cambia.
- [ ] Con un argumento distinto de `vX.Y.Z` (por ejemplo `v0.1.5; id`), `omnidesk-autodeploy` no ejecuta nada y termina en error.

**Comportamiento en el VPS**

- [ ] Antes de cada despliegue automático existe un dump nuevo en `<BACKUP_DIR>/pre-deploy/omnidesk-prod-pre-<tag>.dump`, y un backup posterior del mismo día no lo sustituye.
- [ ] Si el backup falla, no se despliega y el job queda en rojo.
- [ ] Si el despliegue falla antes de levantar contenedores (por ejemplo, falta el bundle), no se hace rollback, el log dice `fallo_sin_cambios` y el job queda en rojo.
- [ ] Si el despliegue del tag nuevo falla después de levantarlo (por ejemplo, el healthcheck), se vuelve a desplegar el tag anterior: `/health` responde la versión anterior, el log dice `rollback` y el job queda en rojo.
- [ ] Si también falla el rollback, el log dice `fallo_sin_rollback`, se crea `autodeploy.paused` y el mensaje del job indica restaurar el dump de `pre-deploy/` y la versión a mano.
- [ ] Con `/srv/omnidesk/autodeploy.paused`, un tag nuevo no se despliega, el log dice `pausado` y el job queda en verde con un aviso.
- [ ] Re-ejecutar un run antiguo con un tag menor o igual que el desplegado no hace downgrade (log `omitido`).
- [ ] Un `omnidesk-deploy` manual en curso hace que el automático falle con `ocupado`, sin tocar nada.
- [ ] Si se corta la conexión SSH a mitad de un despliegue, el script termina (con rollback si hace falta) y deja su línea en `autodeploy.log`.
- [ ] Cada ejecución deja una línea en `/srv/omnidesk/autodeploy.log` y su salida en `/srv/omnidesk/autodeploy/<tag>.out`.
- [ ] El bundle contiene `omnidesk-autodeploy`, y `omnidesk-deploy` avisa si el instalado es distinto.

**Documentación**

- [ ] `docs/despliegue.md` explica, paso a paso:
  - activar el despliegue automático (login por contraseña, `known_hosts` y secretos);
  - pausar y reanudar;
  - ver el resultado;
  - qué hacer si el rollback falla;
  - rotar la contraseña o revocar el acceso de GitHub.

## Decisiones

- **Sí:** GitHub entra por SSH (push). Decisión del usuario. Es inmediato, y el resultado se ve en Actions, donde el usuario quiere verlo.
- **No:** un timer en el VPS que consulte `ghcr.io` (pull). No necesitaría credenciales del VPS en GitHub, pero tarda hasta un intervalo y GitHub no se enteraría del resultado sin otro token con más permisos.
- **No:** runner autoalojado en el VPS. Ejecutaría código de los workflows en el servidor de prod y consumiría RAM del VPS mínimo.
- **Sí:** usuario `ubuntu` con su contraseña. Decisión del usuario. Reutiliza el `docker login` y los permisos de `/srv/omnidesk`, y no hay que gestionar claves SSH.
- **No:** copiar el token `read:packages` a GitHub. El pipeline no lo necesita (usa su `GITHUB_TOKEN`) y sigue siendo una credencial solo del VPS.
- **No:** clave SSH restringida (`command=…,restrict`). Era más segura (una clave robada solo podría desplegar una versión publicada), pero el usuario prefiere la contraseña. Queda como mejora para otro spec.
- **Sí:** `sshpass -e`. La contraseña viaja en una variable de entorno, no en los argumentos del proceso, y GitHub la oculta en los logs.
- **Sí:** `known_hosts` fijado y `StrictHostKeyChecking=yes`. Sin eso, GitHub podría enviar la contraseña a un servidor que se hiciera pasar por el VPS.
- **Sí:** backup previo y rollback automático. Decisión del usuario. El rollback vuelve a la versión anterior pero no restaura la base; si una migración lo impide, avisa en lugar de improvisar.
- **Sí:** el backup previo se copia a `pre-deploy/` con el tag en el nombre. La rotación diaria sustituye el dump del mismo día, y un segundo despliegue o el backup de las 03:00 borrarían el único dump anterior a una migración fallida.
- **Sí:** rollback solo si algo cambió. Si el fallo fue antes de `up`, la versión anterior sigue en marcha; volver a desplegarla solo causaría un reinicio y un log engañoso.
- **Sí:** pausa automática tras `fallo_sin_rollback`. La base puede estar a medio migrar; desplegar la siguiente versión, o hacer otro backup previo, empeoraría la situación.
- **Sí:** interruptor de pausa con un archivo. Decisión del usuario. Sin él, el siguiente push volvería a subir una versión que se acaba de retirar a mano.
- **Sí:** «solo avanza». Re-ejecutar un run viejo no debe hacer un downgrade; para volver atrás está `omnidesk-deploy` a mano.
- **Sí:** cerrojo compartido entre el despliegue manual y el automático, con `OMNIDESK_DEPLOY_LOCK_HELD` para que el automático pueda llamar a `omnidesk-deploy`. Dos `docker compose up` simultáneos sobre el mismo proyecto dejan un estado imprevisible.
- **Sí:** el script ignora `SIGHUP` y `SIGPIPE`. Un corte de conexión no debe dejar un despliegue a medias y sin rollback.
- **Sí:** resultado en Actions (última línea `OMNIDESK_RESULTADO=…`) y en `autodeploy.log` en el VPS. Decisión del usuario. Sin servicios ni secretos nuevos para notificar.
- **Sí:** sin secretos, el job avisa y termina en verde. El pipeline sigue funcionando entre fusionar este spec y configurar el acceso.
- **Sí:** las versiones publicadas durante una pausa o rechazadas por `ocupado` no se despliegan solas. Desplegar algo que nadie pidió mientras alguien investiga una incidencia sería peor; la siguiente versión, o un `omnidesk-deploy` manual, la recupera.
- **Sí:** `omnidesk-autodeploy` viaja en el bundle, igual que `omnidesk-deploy`. En el VPS no hay código fuente (SPEC 27).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Se filtra `VPS_PASSWORD` (de GitHub o de un log) | Da acceso completo al VPS como `ubuntu`. Se acepta por decisión del usuario. GitHub oculta los secretos en los logs y `sshpass -e` no los pone en la línea de comandos. Se documenta cómo rotar o revocar. Mejora futura: clave restringida. |
| Cambiar la contraseña de `ubuntu` rompe el despliegue automático | La guía de rotación incluye actualizar `VPS_PASSWORD`. El job queda en rojo con un error de autenticación, no a medias. |
| SSH abierto a internet acepta contraseñas | Ya era así (SPEC 25). Conviene una contraseña larga y aleatoria. Se anota para otro spec (`fail2ban`, claves solamente). |
| Un commit malo llega a prod sin que nadie lo mire | Solo se publican tags de `main` verdes (lint, tests, build, migraciones). Backup previo, rollback automático y pausa. |
| Una migración incompatible hace fallar también el rollback | El log y el job lo dicen (`fallo_sin_rollback`), se pausa solo y se indica restaurar el dump de `pre-deploy/`, que siempre se hace antes. |
| La huella del VPS cambia (reinstalación) y los despliegues fallan | Es lo esperado: se actualiza `VPS_KNOWN_HOSTS` tras comprobar la huella nueva. Se documenta. |
| El job se corta a mitad (tiempo máximo, caída de la conexión) | El script ignora `SIGHUP`/`SIGPIPE` y termina en el VPS (con rollback si hace falta). El job queda en rojo y remite a `autodeploy.log`. El cerrojo evita solapes. |
| Los backups llenan el disco | `backup.sh` conserva 7 diarios; `pre-deploy/` conserva 3 dumps (sin el tar de adjuntos). Presupuesto de disco de SPEC 25. |
| El VPS se actualiza a un `omnidesk-autodeploy` que no entiende el bundle | Viaja en el bundle y `omnidesk-deploy` avisa si el instalado es distinto, igual que con el propio `omnidesk-deploy`. |
| Alguien deja la pausa puesta y olvida quitarla | Cada run pausado queda en verde con un aviso visible en el resumen de Actions y en el log. |

## Lo que **no** entra en este spec

- Clave SSH restringida, desactivar las contraseñas SSH, `fail2ban`, cambiar de puerto o limitar SSH por IP.
- Aprobación manual antes de desplegar.
- Notificaciones por email o chat.
- Restaurar la base en un rollback automático.
- Blue/green.
- Ejecución manual del workflow para desplegar una versión concreta.
- Otros entornos.

Cada uno de esos, si llega, va en su propio spec.

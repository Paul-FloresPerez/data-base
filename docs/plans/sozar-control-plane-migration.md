# Plan de migración: plano de control HLR de Sozar

Estado: **borrador local, no aplicado**. Este plan no habilita el proveedor ni
crea tráfico HTTP. Se conserva separado de la migración de auditoría que está
en `stash@{0}` y debe aplicarse después de revisar su propio respaldo.

## Objetivo

Persistir únicamente el control operativo de futuras consultas reales:

- huella HMAC del móvil normalizado, nunca el móvil en las nuevas tablas;
- caché de respuestas reales con fecha de vigencia;
- autorización explícita con cupo, presupuesto y coste máximo por consulta en
  céntimos; una aprobación no puede pasar a `APROBADA` sin un coste explícito;
- trabajos con los estados `PENDIENTE`, `EN_CURSO`, `EXITOSA`, `INCIERTA` y
  `FALLIDA`;
- reservas atómicas de un único trabajador y eventos sin datos personales.

Los valores simulados no se escriben en la caché real. Los resultados de
estado `INCIERTA` no se reintentan automáticamente: requieren conciliación
manual con el proveedor para evitar un cobro duplicado.

## Orden de despliegue propuesto

1. Verificar y aplicar primero la migración de auditoría pendiente desde su
   rama y respaldo aprobados. No aplicar el stash directamente.
2. Crear una rama/entorno Neon de prueba independiente y tomar un respaldo
   verificable de Production.
3. Revisar el SQL de `20261026090000_add_sozar_hlr_control_plane` y
   `20261026090100_add_shared_login_rate_limits`; aplicarlos con
   `npx prisma migrate deploy` solamente en la rama de prueba.
4. Probar creación idempotente, reserva concurrente, agotamiento de cupo,
   expiración de reserva y que `INCIERTA` no vuelva a `PENDIENTE`.
5. Tras aprobación explícita, aplicar ambas migraciones a Production con
   `npx prisma migrate deploy`. Nunca usar `db push` ni `migrate reset`.
6. Desplegar el código que consume estas tablas solo después de que la
   migración figure en `_prisma_migrations` y de mantener la puerta de código
   de Sozar en `false`.

La migración de auditoría que aparece en `stash@{0}` modifica el esquema, pero
el stash no contiene su SQL versionado. No hay choque de nombres con estas dos
migraciones; aun así, su migración debe reconstruirse y revisarse como un
artefacto separado antes de colocarse cronológicamente delante de estas.

## Recuperación

La migración solo añade tablas, índices, claves foráneas y triggers de
integridad; el rollback es `DROP TABLE` de las cinco tablas nuevas, las dos
funciones de trigger y los tres enums, únicamente si no
existen datos operativos que deban conservarse. Antes de cualquier rollback se
debe restaurar el respaldo de rama o exportar los eventos de control. No toca
`bases`, `registros`, `lotes` ni `usuarios`.

## Variables futuras de servidor

- `SOZAR_ENDPOINT_TEMPLATE`
- `SOZAR_TIMEOUT_MS`
- `SOZAR_AUTH_MODE` (`none`, `bearer` o `header`)
- `SOZAR_API_TOKEN` o `SOZAR_AUTH_HEADER` + `SOZAR_AUTH_SECRET`
- una clave HMAC privada para obtener la huella de móvil

No usar prefijos `NEXT_PUBLIC_`. Configurarlas no habilita tráfico: la puerta
de ejecución queda bloqueada en código y el adaptador de respuesta sigue
pendiente de contrato oficial.

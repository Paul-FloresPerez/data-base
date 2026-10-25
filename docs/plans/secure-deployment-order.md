# Orden de despliegue seguro: auditoría, Sozar y login

Estado: preparación local. Ninguna de estas migraciones se ha aplicado a
Production ni habilita tráfico hacia Sozar.

## Orden obligatorio

1. Recuperar y verificar un respaldo independiente de Production. Comprobar
   sus credenciales con una consulta `SELECT` de solo lectura, sin imprimir la
   URL ni datos de contactos.
2. Crear una rama PostgreSQL de prueba independiente y configurar únicamente
   `DATABASE_URL_AUDIT_TEST_UNPOOLED` con su conexión directa válida.
3. En la rama de prueba, configurar temporalmente `DATABASE_URL_UNPOOLED` con
   esa misma conexión y ejecutar `npx prisma migrate deploy`.
4. Verificar, en este orden, las migraciones:
   - `20261024014500_add_audit_events`
   - `20261026090000_add_sozar_hlr_control_plane`
   - `20261026090100_add_shared_login_rate_limits`
5. Ejecutar pruebas de login, guardado, auditoría, reciclaje y exportación en
   la rama de prueba. Confirmar que no hay llamadas HTTP a Sozar.
6. Con un respaldo verificado y una ventana de despliegue aprobada, aplicar
   `npx prisma migrate deploy` a Production antes de desplegar esta rama.
   Nunca usar `prisma db push` ni `migrate reset`.
7. Desplegar la aplicación solo cuando las tres migraciones figuren como
   finalizadas. El nuevo rate limiter falla cerrado si su tabla no existe.

## Vercel y servidores propios

En Vercel, `DATABASE_URL` debe ser la conexión pooled de runtime y
`DATABASE_URL_UNPOOLED` una conexión directa reservada para CLI/migraciones.
`NEXTAUTH_SECRET` o `AUTH_SECRET` se mantiene exclusivamente en el servidor.
No definir secretos con `NEXT_PUBLIC_`.

En servidores propios, usar PostgreSQL compatible y ejecutar las migraciones
desde un proceso de despliegue con conexión directa. El código de Sozar usa
Node, PostgreSQL y Prisma; el adaptador Prisma actual sigue siendo Neon y debe
sustituirse por un adaptador PostgreSQL estándar antes de abandonar Neon.

## Sozar

No basta configurar variables: `SOZAR_EXECUTION_CODE_GATE` permanece en
`false`. Para una activación futura hacen falta el contrato JSON del proveedor,
precios confirmados, una clave HMAC privada, una aprobación explícita de cupo
y presupuesto, y una revisión de código independiente.

# Migraciones Prisma con destino verificado

Las migraciones se ejecutan exclusivamente mediante `npm run db:migrate:safe`.
Nunca usar `npx prisma migrate deploy` directamente: la configuración raíz no
contiene una URL de datasource, por lo que el comando falla antes de conectarse.

## Variables privadas requeridas

Configurar en el entorno de la máquina o del runner (nunca en Git):

- `PRISMA_MIGRATION_TEST_URL`
- `PRISMA_MIGRATION_TEST_BRANCH_ID`
- `PRISMA_MIGRATION_PRODUCTION_URL`
- `PRISMA_MIGRATION_PRODUCTION_BRANCH_ID`

Las URL deben ser conexiones PostgreSQL directas. Las variables de migración son
independientes de `DATABASE_URL` y `DATABASE_URL_UNPOOLED`: el lanzador no usa
estas últimas ni ofrece fallback a ellas.

## Test

```powershell
$env:PRISMA_MIGRATION_TARGET = "test"
$env:PRISMA_MIGRATION_CONFIRM = "MIGRATE_TEST"
npm run db:migrate:safe
```

Antes de invocar Prisma, el lanzador consulta solamente `current_setting('neon.branch_id', true)` y exige que coincida con `PRISMA_MIGRATION_TEST_BRANCH_ID`. Una URL de Production, Backup, o una variable ausente bloquea el proceso. `backup` no es un destino válido.

## Production

```powershell
$env:PRISMA_MIGRATION_TARGET = "production"
$env:PRISMA_MIGRATION_CONFIRM = "MIGRATE_PRODUCTION"
npm run db:migrate:safe
```

El mismo proceso usa únicamente las variables dedicadas de Production, valida su
`branch_id` y solo entonces inicia `prisma migrate deploy` con
`prisma.migration.config.ts`. El valor de conexión se mantiene en el proceso
hijo y no se imprime.

## Servidor PostgreSQL propio

El preflight usa el cliente PostgreSQL estándar `pg`; no depende de Vercel. Para
un servidor sin Neon, se sustituye cada variable `*_BRANCH_ID` por la variable
equivalente `PRISMA_MIGRATION_<DESTINO>_DATABASE_NAME`. El lanzador verifica
`current_database()` antes de Prisma. En conexiones Neon, el `branch_id` sigue
siendo obligatorio y nunca se acepta este fallback.

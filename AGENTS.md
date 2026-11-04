<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Módulos comerciales y reciclaje

Antes de modificar importación CRM, reciclaje, ventas, reservas, campañas,
distribución o exportación comercial, lee íntegramente
[`docs/REGLAS_INVIOLABLES.md`](docs/REGLAS_INVIOLABLES.md). Sus reglas de
integridad, trazabilidad y bloqueos prevalecen sobre cambios de interfaz o
atajos de procesamiento. No se permite relajar una regla para resolver un
fallo visual; cualquier cambio de esquema debe preservarla con una migración
incremental, pruebas de regresión y un plan de recuperación.

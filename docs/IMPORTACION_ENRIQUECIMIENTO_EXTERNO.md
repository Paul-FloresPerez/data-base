# Importación con enriquecimiento externo

Una base ORIGINAL puede seguir el modo `ENRIQUECIMIENTO_EXTERNO` sin abrir Sozar ni generar datos MOCK. El flujo es: limpiar y guardar la base, exportar la lista de móviles aptos, importar un XLSX de resultados, mapear sus columnas, revisar la conciliación, guardar y segmentar mediante las reglas comerciales normales.

## Contrato de plantilla

La plantilla maestra conserva sus 22 columnas, orden y valores originales. La unión solo puede modificar las columnas ya existentes: `Operador Actual`, `Operador Original`, `Portabilidad Desde`, `Fecha Portabilidad`, `Año` y `Mes`. `Año` y `Mes` se derivan únicamente de una fecha de portabilidad válida. Nunca se añade una columna externa, se rellena un valor ausente por inferencia ni se equipara un operador donante con `Portabilidad Desde`.

## Conciliación y trazabilidad

La clave es el móvil español normalizado. Resultados con móvil inválido, duplicado, ajeno a la base o ausente se cuentan y no se aplican. Un valor existente distinto requiere confirmación explícita antes de sustituirse. Cada importación conserva nombre, huella SHA-256, fecha, columnas fuente y resumen; la misma huella no vuelve a aplicar cambios. La procedencia queda como `EXCEL`, nunca `API_REAL`.

## Verificaciones ejecutadas

- Prueba unitaria: plantilla de 22 columnas, resultados desordenados/parciales, conflicto explícito, móvil desconocido, inválido e idempotencia.
- Suite completa: `npm test` (184 pruebas).
- TypeScript, ESLint focalizado y `prisma validate`.
- Build: `npm run build --webpack` correcto.
- Neon Test `br-fragrant-heart-b5nue1w1`: 9.999 registros EXCEL con guardado completo sin lotes, reservas ni llamadas Sozar; limpieza exacta de fixtures.

La elegibilidad comercial, ventas, oposición, reservas, permanencia y matriz Vodafone/Yoigo no se modifican: siguen evaluándose en servidor al distribuir.

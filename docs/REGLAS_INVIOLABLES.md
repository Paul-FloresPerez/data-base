# Reglas inviolables de Data-base

Este documento define las restricciones que cualquier cambio en importación,
reciclaje, ventas, distribución, exportación o enriquecimiento debe preservar.
No sustituye una regla comercial por una inferencia técnica ni habilita una
operación por el hecho de que exista una pantalla.

## Identidad y trazabilidad

1. Una base ORIGINAL tiene UUID y código inmutables. Una RECICLADA conserva la
   referencia permanente a su base ORIGINAL y a la ejecución que la generó.
2. La fila original, sus columnas, ceros iniciales y procedencia se conservan.
   Los registros inválidos se mantienen como incidencias; solo se excluyen de
   operaciones que requieren móviles válidos.
3. La conciliación usa exclusivamente móvil español normalizado: nueve dígitos
   iniciados en 6 o 7, admitiendo `+34` y `0034`. No usa número de fila,
   nombre de archivo ni posición como identidad de contacto.
4. Una gestión CRM es histórica y append-only. Una importación posterior no
   modifica ejecuciones, resultados ni decisiones anteriores.
5. Un archivo CRM, su hoja, fila, ruta ZIP y huella de contenido deben poder
   rastrearse sin registrar binarios ni datos personales en logs.

## Reciclaje y elegibilidad

1. La selección de una tipificación solo define qué gestiones se evalúan; no
   autoriza contacto ni crea elegibilidad.
2. Una ejecución conserva criterios, fecha efectiva, archivos utilizados,
   incidencias y decisiones. Se reevalúa únicamente mediante una nueva
   ejecución, nunca mutando un snapshot anterior.
3. Se aplican cuatro meses calendario completos de permanencia y el límite
   histórico desde 2019-02-01. Fechas inválidas, ausentes o fuera de rango se
   revisan, no se inventan.
4. Venta confirmada bloquea global y permanentemente. Datos ambiguos quedan en
   revisión y nunca se convierten en venta confirmada por inferencia.
5. Una reserva comercial ACTIVA bloquea una nueva distribución global del mismo
   móvil. Su liberación es explícita, autorizada y auditada.
6. Un resultado MOCK no acredita operador real para distribución definitiva;
   EXCEL, CRM, MOCK y API_REAL permanecen diferenciados.

## Jerarquía comercial y tipificaciones normalizadas

La evidencia se resuelve en este orden: venta externa CONFIRMADA, oposición al
contacto, reserva ACTIVA, gestiones CRM y, finalmente, operador/portabilidad.
Una tipificación de CRM nunca crea por sí sola una venta externa confirmada.

| Categoría | Textos exactos admitidos | Decisión automática |
|---|---|---|
| CONTACTO_NO_ESTABLECIDO | NO RESPONDE, NO CONTESTA, BUZÓN DE VOZ | Candidato si cumple el resto de reglas |
| CONTACTO_INTERRUMPIDO | CORTA LLAMADA | Candidato solo sin restricción posterior |
| SEGUIMIENTO_PENDIENTE | AGENDADO | Revisión hasta resolución explícita |
| INTERES_COMERCIAL | INTERESADO, CONOCE EL MÉTODO | Revisión hasta resolución explícita |
| VENTA_CRM_NO_CONFIRMADA | VENTA, VENDIDO, VENTA CONFIRMADA | Revisión; no crea venta externa |
| RECHAZO_COMERCIAL | NO INTERESA | Excluido del reciclaje automático |
| DATOS_INCORRECTOS | OPERADOR INCORRECTO, NO ES TITULAR, TITULAR INCORRECTO | Revisión |
| OPOSICION_CONTACTO | LISTA ROBINSON, OPOSICIÓN, NO LLAMAR, NO CONTACTAR | Supresión prioritaria y revisión |
| OTROS_REQUIERE_REVISION | Cualquier texto no listado | Revisión conservadora |

Las decisiones anteriores son obligatorias. La equivalencia de nuevos textos,
la caducidad o cierre de AGENDADO/INTERESADO y listas externas de oposición
requieren parametrización futura, evidencia auditada y pruebas de regresión.

## Reciclaje global aprobado

1. Las bases ORIGINAL válidamente guardadas forman el universo de búsqueda. La
   consulta se resuelve en servidor, de forma paginada; no se descarga ese
   universo al navegador.
2. Un archivo CRM tiene una identidad canónica y puede conciliarse contra más
   de una base ORIGINAL. Su nombre empresarial se conserva y no determina por
   sí solo la base de procedencia.
3. Cada fila canónica conserva archivo, hoja y fila de origen. Las gestiones
   históricas ya importadas permanecen intactas durante la transición; una
   reimportación idéntica no duplica filas ni gestiones.
4. Un móvil puede estar en varias bases y tener varias procedencias. El sistema
   conserva todas; solo podrá seleccionarlo una vez si los datos materiales son
   consistentes. Una contradicción material exige REVISIÓN y nunca se resuelve
   eligiendo una base silenciosamente.
5. Cada ejecución global deberá registrar criterios, archivos canónicos,
   asociaciones por base y decisiones. No modifica ejecuciones ya guardadas ni
   elimina incidencias de móviles no encontrados.

## Distribución y exportación

1. La matriz comercial vigente se evalúa por operador actual confiable, nunca
   por operador original o donante. Operadores desconocidos o contradictorios
   pasan a revisión.
2. Cada lote comercial contiene como máximo 100 registros. No existe mínimo
   de 100; los lotes menores válidos siguen siendo lotes válidos.
3. Una vista previa o descarga local no crea reservas ni equivale a distribución
   comercial. La descarga comercial definitiva usa exclusivamente lotes
   persistidos, confirmados y con reservas activas verificadas en servidor.
4. El XLSX CRM conserva exactamente los 24 encabezados oficiales cuando ese
   contrato aplica. La descarga normal de reciclaje se conserva separada.

## Seguridad y operación

1. Validaciones de base, registro, móvil, campaña, lote, venta y reserva se
   ejecutan en servidor; el navegador no es fuente de verdad.
2. Operaciones repetidas o concurrentes son idempotentes y coordinadas por
   móvil normalizado cuando afectan ventas, reservas o lotes.
3. Las tres puertas de Sozar permanecen cerradas salvo autorización expresa;
   ninguna compilación, importación o prueba puede generar consultas pagadas.
4. Las migraciones son incrementales. Nunca se usa `db push`, `reset` ni se
   modifica Production sin respaldo, destino validado y autorización.
5. El archivado de una base es lógico, reversible y auditado. Nunca elimina
   registros, gestiones, lotes, ventas ni reservas, y no libera reservas. Una
   base archivada queda fuera de nuevos trabajos operativos, conciliación y
   reciclaje global hasta su restauración administrativa explícita.

## Controles de regresión requeridos

Todo cambio relevante debe añadir o ejecutar controles que prueben:

- normalización de móviles, inválidos, fijos y duplicados;
- conservación de columnas originales y procedencia;
- snapshots inmutables de reciclaje y reintentos idempotentes;
- ventas confirmadas y reservas activas bloqueando reciclaje y distribución;
- matriz por operador actual y exclusión de MOCK;
- lotes de 7, 68, 100 y 145 registros (100 + 45);
- encabezados CRM exactos y contenido real de XLSX/ZIP;
- autorización de rutas y ausencia de consultas Sozar;
- para una futura conciliación global: archivo reutilizado, móvil en varias
  bases, cero coincidencias, conflicto entre bases y consulta paginada sin
  cargar registros CRM en el navegador.

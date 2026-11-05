# Importación incremental de bases originales

La vía incremental crea una sola `Base` ORIGINAL lógica y un
`TrabajoProcesamiento` persistente. Cada CSV fuente queda representado por un
`ArchivoProcesamiento`; cada registro conserva el archivo, la hoja lógica
`CSV` y su fila de origen. Los checkpoints se escriben en la misma transacción
que sus registros: un bloque no se considera completado antes del commit.

## CSV soportado

El lector consume `AsyncIterable<Uint8Array>` progresivamente. El productor
debe guardar el archivo fuera de la solicitud web y entregar al worker una
referencia privada durable, su SHA-256, encabezados y número de filas. No se
envía el archivo completo al navegador ni se almacena como memoria temporal de
una función. Se admiten delimitadores CSV explícitos (coma, punto y coma o
tabulador), UTF-8 con BOM, CRLF y celdas entrecomilladas.

## XLSX

La biblioteca SheetJS CE 0.20.3 actualmente usada por la aplicación no ofrece
lectura XLSX verdaderamente progresiva para este flujo: abre el libro en
memoria. Por tanto, XLSX sigue limitado al flujo existente de hasta 10.000
registros y **no** se anuncia como vía masiva. Para admitir XLSX masivo hace
falta un conversor/lector streaming probado y almacenamiento durable de los
archivos, antes de habilitarlo.

## Reanudación e idempotencia

`TrabajoProcesamiento` coordina leases, reintentos y `SKIP LOCKED`. La clave de
operación es idempotente; cada bloque solo puede completar con su lease vigente
y sus filas exactas. Una inserción duplicada inesperada falla: nunca se oculta
con `skipDuplicates`. Tras completar todos los bloques, la finalización cuenta
las filas, normaliza duplicados de móvil dentro de la base y solo entonces
marca la base como completada y apta para los flujos posteriores.

## Límite de esta etapa

La aplicación contiene el núcleo servidor/worker y el contrato de referencia
privada, pero no instala un proveedor de almacenamiento ni un worker externo.
Para 100.000+ filas en producción se necesita conectar una cola/worker
persistente y almacenamiento privado compatible; ninguna solicitud de Vercel
debe intentar alojar ni procesar el archivo entero.

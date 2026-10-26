# Prueba controlada de una respuesta Sozar

Esta preparación no habilita Sozar. `SOZAR_EXECUTION_CODE_GATE` permanece en
`false` y `isSozarHlrExecutionEnabled` también permanece en `false`; por tanto
ningún cambio de entorno puede producir tráfico al proveedor.

## Antes de autorizar una única consulta

1. Recibir por canal empresarial el contrato de autenticación, tarifa exacta
   por consulta, límites aplicables y una respuesta JSON anonimizada o su
   documentación oficial.
2. Revisar el contrato y definir únicamente rutas JSON corroboradas en un
   `DocumentedSozarResponseContract`. No se debe adivinar ningún campo.
3. Configurar en servidor, nunca con prefijo `NEXT_PUBLIC_`, una clave HMAC de
   huella de móvil y una clave de cifrado de 32 bytes codificada en base64url
   para la respuesta inicial. Configure la segunda como
   `SOZAR_RESPONSE_ENCRYPTION_KEY`; ambas deben estar disponibles solo para el
   proceso de servidor.
4. Como administrador autenticado, seleccionar un único móvil pendiente en la
   base activa y confirmar de forma explícita la operación. El servidor debe
   llamar a `preflightSingleSozarTest`, que comprueba base, sesión, límite
   exactamente igual a uno, presupuesto/coste ya confirmados, caché real y
   cualquier estado previo de cola.
5. Solo si el preflight devuelve `LISTO_PARA_UNA_CONSULTA`, crear en una única
   transacción la aprobación, la consulta y su evento `COLA_PREPARADA`. La
   clave de idempotencia usa base y huella, no el teléfono. Un resultado
   vigente se reutiliza; `PENDIENTE`, `EN_CURSO`, `EXITOSA`, `INCIERTA` y
   `FALLIDA` bloquean una segunda consulta automática.

## Tras la única respuesta

- Guardar el JSON original cifrado dentro de `ResultadoHlrReal.resultado`, con
  la huella del móvil y el vencimiento de caché. No incluirlo en auditoría,
  logs, respuestas HTTP ni props de React.
- Exponer solo su estructura (tipos y claves) a revisión administrativa.
- Aplicar el mapeo únicamente después de documentar rutas inequívocas. Si falta
  un campo o la forma es desconocida, conservar la respuesta cifrada y dejar
  las columnas sin completar.
- Vincular por móvil normalizado, nunca por fila; el aplicador preserva todas
  las demás celdas y el orden original.

La primera ejecución real requiere un cambio de código revisado que abra ambas
puertas, un despliegue independiente y autorización expresa. Esta rama no
contiene ese cambio.

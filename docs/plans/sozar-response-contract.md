# Contrato de respuesta Sozar pendiente

La aplicación no asume nombres ni estructura del JSON de Sozar. La ejecución
permanece bloqueada por `SOZAR_EXECUTION_CODE_GATE = false` aunque se configuren
variables de entorno.

Antes de autorizar una primera consulta se requiere, por un canal privado:

1. Un ejemplo anonimizado de respuesta de éxito y de error, asociado a un móvil
   de prueba autorizado.
2. La versión o fecha del contrato y el significado exacto de operador actual,
   original, donante y fecha de portabilidad.
3. Rutas JSON para cada campo disponible. Los campos no documentados se
   conservarán como `null`; no se infieren ni se copian desde otros campos.
4. Confirmación de autenticación, coste unitario, moneda, límites, semántica de
   errores y comportamiento ante timeout.

El adaptador acepta una `DocumentedSozarResponseContract` revisada. Si el
proveedor devuelve el móvil, su valor normalizado debe coincidir con el móvil
de la solicitud; la asociación nunca se realiza por fila de Excel. Si no lo
devuelve, la respuesta queda ligada únicamente al móvil normalizado ya validado
de la solicitud. El contrato aún no está instalado en el código productivo.

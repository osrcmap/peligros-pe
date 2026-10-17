# Limitaciones

Lee esto antes de usar `peligros-pe` para informar a personas.

## Lo que el inventario no es

- **No es un mapa de todo el peligro.** Es el inventario de lo que INGEMMET registró en estudios de campo, fotointerpretación y reportes. Hay zonas peligrosas sin registro. Ausencia de registros ≠ seguridad.
- **No es una alerta.** No dice si *hoy* va a pasar algo. Para eso hacen falta los avisos del SENAMHI, la lluvia en la cuenca y los sensores del IGP (otras piezas de este proyecto).
- **Cada registro es un punto.** Un huaico recorre la quebrada y se abre en el cono de deyección. Una inundación cubre la llanura. El punto marca dónde se registró el fenómeno, no el área que puede afectar. Por eso el radio por defecto es 2 km y se mide al punto, no a un borde.

## Calidad de la fuente

- **8 zonas críticas sin coordenadas** (Torre Blanca en Carabayllo, Variante de Pasamayo en Ancón, Quebrada Quisa en Naván, entre otras). `cerca` no puede medir su distancia; las muestra en `sin_coordenadas_en_distritos_cercanos` cuando hay otros registros del mismo distrito, y `listar --ubigeo` siempre las incluye.
- **Ubigeo inferido por nombre** en esos 8 registros (la fuente trae `--error--`). Se marca con `ubigeo_origen: "inferido_por_nombre"` y solo se infiere si el nombre de departamento + provincia + distrito corresponde a un único ubigeo.
- **Texto libre.** El tipo de peligro de las zonas críticas tiene 756 variantes (con erratas). Las `categorias` se derivan por palabras clave y pueden fallar. El texto original se conserva en `peligro`.
- **Códigos fuera del diccionario.** 7,597 peligros tienen subtipos (`1301`, `1302`) y 85 un tipo (`2500`) que no están en el dominio publicado. Para ellos `subtipo` (o `tipo`) es `null`; se conserva `codigo_peligro`.
- **Textos truncados en la fuente.** Algunos `elementos_expuestos` terminan a mitad de frase.
- **Antigüedad.** El 79 % de los peligros tiene fecha entre 2003 y 2012 (estudios regionales por franjas); 3,502 son de 2020-2026 (el más reciente, julio de 2026); 524 no tienen fecha. Las zonas críticas no traen fecha. El terreno y la ocupación urbana cambiaron desde entonces.
- **Registros en revisión.** 1,485 peligros están marcados por INGEMMET como "En revisión"; se publican con `en_revision: true`.
- **Registros excluidos.** 459 peligros marcados `NoMostrarWEB` por INGEMMET no se publican.

## Técnicas

- La distancia es geodésica sobre la esfera (Turf), suficiente para radios de hasta 50 km.
- El paquete trae los datos de la última captura. `doctor` avisa si tienen más de 45 días o si la fuente cambió desde entonces.
- `geocatmin.ingemmet.gob.pe` no envía el certificado TLS intermedio. El cliente lo incluye (Sectigo OV R36, vence en 2036); si INGEMMET cambia de CA hay que actualizarlo en `src/geocatmin.ts`.

## Licencia de los datos

El servicio de INGEMMET no declara licencia (`copyrightText` vacío). Los datos son públicos y gratuitos en GEOCATMIN, pero no hay una licencia explícita de reutilización. Pendiente de confirmar con INGEMMET.

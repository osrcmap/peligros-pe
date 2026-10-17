# Investigación de fuentes

Lo que descubrimos al construir `peligros-pe`, para que nadie tenga que redescubrirlo. Verificado el 17 de octubre de 2026.

## INGEMMET – GEOCATMIN (fuente usada)

Servicio ArcGIS Server 10.91:
`https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_PELIGROS_GEOLOGICOS/MapServer`

| Capa | Nombre | Geometría | Registros |
|---|---|---|---|
| 0 | Peligros Geológicos | punto | 28,915 |
| 1 | Otros Peligros Geológicos | punto | 8,911 |
| 2 | Zonas Críticas | punto | 2,186 |
| 3 | Peligros por Región | polígono | — |
| 4 | Regiones con Estudios de Riesgo | polígono | — |
| 5 | Estudios de Riesgo por Franjas | polígono | — |
| 6 | Cartografía de Peligros | polígono | — |
| 7 | Cartografía Peligros Fotointerpretado | polígono | — |

Las capas 3 a 7 aún no se usan. La 6 y la 7 (polígonos de peligro) son candidatas para una versión que mida a bordes de áreas y no solo a puntos.

### Cómo descargar

- `query` acepta `f=geojson` y `outSR=4326`.
- **No hay paginación** (`resultOffset` devuelve "Pagination is not supported") y `maxRecordCount` es 2000. Hay que pedir `returnIdsOnly=true` y luego bajar por lotes de `objectIds` (usamos POST, lotes de 500).
- **TLS incompleto:** el servidor no envía el intermedio *Sectigo Public Server Authentication CA OV R36*. Sin él, Node/Bun/curl fallan con "unable to verify the first certificate". Lo incluimos en el cliente. No desactivar la verificación.
- La descarga completa toma ~15 s.

### Campos y semántica

**Zonas críticas (capa 2):** `PELIGROS_G` (texto libre, 756 variantes), `PARAJE`, `ELEMENTO` (elementos expuestos), `RECOMEND`/`RECOMEND_1` (casi siempre vacíos), `BOLETIN`, `URL_BOLETIN` (handle del repositorio INGEMMET), `PROYECTO`, `CD_DIST` (ubigeo), `NM_DEPA/NM_PROV/NM_DIST`, `REGION/PROVINCIA/DISTRITO`, `X_GEO/Y_GEO`, `X/Y/ZONA` (UTM). `ANIO` y `FOTO` siempre nulos. `INDICADORACTIVO` es `"A"` en 2,184 registros y nulo en 2: no lo publicamos porque no sabemos qué distingue.

**Peligros (capas 0 y 1):** dominios *codedValue* en la metadata de la capa (`/MapServer/0?f=json`), que decodificamos en cada captura:
- `COD_PELIGRO`: 1000 Movimientos en masa, 2000 Otros peligros geológicos, 3000 Geohidrológicos, 4000 Volcánicos, 5000 Sismos.
- `TIP_PELIGRO` (`1000|1500` = Flujos, ...) y `NOM_PELIGRO` (`1000|1500|1504` = Flujo de detritos, ...).
- `FACT_GEOGR` (detonantes, p. ej. "Lluvias intensas"), `FACT_SITIO`, `FACT_ANTRO`, `FUENTE` (Información de campo, Fotointerpretación, COEN...), `REGISTRO`.
- `FECHA` en milisegundos; llegan como 00:00Z o 05:00Z del día local, así que la fecha UTC es la correcta.

### Problemas encontrados en los datos

- 9 zonas críticas con geometría vacía; 1 recuperable desde `X_GEO/Y_GEO`. Las 8 restantes tienen `Y=0` y `NM_DEPA = "--error--"`.
- Códigos fuera del dominio: `NOM_PELIGRO` `1000|1300|1301` (1,611) y `1000|1300|1302` (6,104), probablemente deslizamiento traslacional/rotacional con código antiguo (el dominio usa `1310`/`1320`); `TIP_PELIGRO` `2000|2500` (85); `FACT_GEOGR` `11` (18,877, solo o junto a otros factores). **No los adivinamos.** Pregunta abierta para INGEMMET.
- `REGISTRO` incluye `NoMostrarWEB` (459), que no está en el dominio. Lo tratamos como "no publicar".
- `ALTURA` con valores imposibles (hasta 30,009 m): se descartan los mayores a 7,000.
- Erratas en texto libre: "Fujo de detritos", "Inundacón fluvial".

## Pendiente de investigar

- **SIGRID (CENEPRED)** y **Perú en Alerta**: otros accesos al mismo inventario, quizá con polígonos o informes por quebrada.
- **Boletines PDF** del repositorio INGEMMET (`hdl.handle.net/20.500.12544/...`): informes por quebrada con historia de activaciones (para la "memoria de la quebrada").
- **Límites distritales oficiales (INEI)**, para ubicar el distrito de un punto sin depender de registros cercanos.
- **Licencia de uso** de los datos de GEOCATMIN.
- Confirmar con INGEMMET el significado de `INDICADORACTIVO`, de los códigos fuera de dominio y de `NoMostrarWEB`.

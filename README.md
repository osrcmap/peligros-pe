# peligros-pe

Inventario de **peligros geológicos y zonas críticas del Perú** (INGEMMET) como GeoJSON versionado, más un CLI *agent-first* para responder una pregunta concreta:

> ¿Qué peligros inventariados hay cerca de este punto?

Es la primera pieza de un conjunto de herramientas abiertas para El Niño 2026-2027 (`avisos-pe`, `lluvia-cuenca`, `igp-huaicos`, `riesgo-punto`). Cada pieza funciona sola y se puede incorporar a bots, paneles municipales o agentes de IA.

> **Información de referencia, no una alerta.** Que no aparezcan registros cerca de un punto **no** significa que el lugar sea seguro. Ante lluvias intensas o una emergencia, sigue a INDECI, SENAMHI y tu municipalidad.

## Uso

```bash
npm i -g @osrcmap/peligros-pe        # o: bun add -g @osrcmap/peligros-pe

peligros-pe cerca --lat -11.9437 --lon -76.7036          # Lurigancho-Chosica, radio 2 km
peligros-pe cerca --lat -11.9437 --lon -76.7036 --tipo huaico --radio 1000
peligros-pe listar --ubigeo 150106                        # todo Carabayllo
peligros-pe zona zc-723ae9dd-0a7f-4f62-84cc-eb57bccf28f0
peligros-pe doctor
```

Sin instalar: `npx @osrcmap/peligros-pe cerca ...` o `bunx @osrcmap/peligros-pe cerca ...`.

Los datos van dentro del paquete: funciona sin conexión y no depende de que GEOCATMIN esté en línea.

```text
Consulta: (-11.9437, -76.7036), radio 600 m
Zonas críticas: 0
Peligros inventariados: 5 (mostrando 3)
     364 m Erosión fluvial — (Lurigancho, Lima, Lima)
     383 m Erosión fluvial — (Lurigancho, Lima, Lima)
     436 m Caída de roca — Pasaje Navidad Chosica (Lurigancho, Lima, Lima)

Fuente: INGEMMET – GEOCATMIN, servicio SERV_PELIGROS_GEOLOGICOS. Captura: 2026-10-17 (hace 0 días).
! Información de referencia del inventario del INGEMMET. No es una alerta ni una orden de evacuación.
! Que no aparezcan registros cerca NO significa que el lugar sea seguro: ...
```

### Comandos

| Comando | Qué hace |
|---|---|
| `cerca --lat --lon [--radio 2000] [--capa] [--tipo] [--limite 50]` | Registros a menos de `--radio` metros, del más cercano al más lejano. También lista las zonas críticas **sin coordenadas** de los distritos encontrados. |
| `listar --ubigeo <2/4/6 dígitos>` | Todo lo inventariado en un departamento, provincia o distrito. Incluye registros sin coordenadas. |
| `zona <id>` | Detalle de un registro (`zc-…` zona crítica, `pg-…` peligro). |
| `schema [comando]` | JSON Schema de entradas y de los registros. |
| `doctor [--sin-red]` | Datos presentes, íntegros (sha256), antigüedad y estado de la fuente. |

- `--capa`: `todas` (por defecto), `zonas_criticas` o `peligros`.
- `--tipo`: `flujo` (huaicos, aluviones; acepta `huaico`), `deslizamiento`, `caida`, `inundacion`, `erosion`, `reptacion`, `hundimiento`, `arenamiento`, `movimiento_complejo`, `otro`. Puedes pasar varios separados por coma.
- Las coordenadas negativas funcionan tal cual (`--lat -12.05`).

### Para agentes

- **JSON por defecto cuando stdout no es una terminal**; `--json` lo fuerza. Un objeto por respuesta.
- `--params '{"lat":-12.05,"lon":-77.04}'` o `--params @consulta.json` en lugar de flags.
- `schema <comando>` devuelve el JSON Schema de la entrada y de los registros.
- Errores en stdout como `{ "ok": false, "code", "error", "hint" }`. Códigos de salida: `2` uso incorrecto, `1` datos o internos.
- Siguientes pasos sugeridos en stderr como NDJSON `{"type":"next-step","command",...}`.
- Toda respuesta con registros incluye `datos` (fuente, fecha de captura, antigüedad) y `aviso`. **Muestra el aviso al usuario final.**
- Ver [`SKILL.md`](SKILL.md).

| Código | Cuándo |
|---|---|
| `ARGS_INVALIDOS` | Parámetro faltante, fuera de rango o desconocido |
| `FUERA_DE_COBERTURA` | El punto no está en el Perú (a menudo lat/lon invertidos) |
| `DATOS_VACIOS` | No hay datos cargados. **Nunca se responde "0 resultados" en ese caso** |
| `DATOS_NO_ENCONTRADOS`, `DATOS_INVALIDOS` | Instalación dañada; corre `doctor` |
| `NO_ENCONTRADO` | `zona` con un id que no existe |

## Cobertura

Captura del 17 de octubre de 2026, servicio `SERV_PELIGROS_GEOLOGICOS` de GEOCATMIN:

| Conjunto | Fuente | Publicados | Notas |
|---|---|---|---|
| Zonas críticas | capa 2 (2,186) | **2,186** | 8 sin coordenadas en la fuente (consultables por ubigeo); 1 con coordenadas recuperadas de `X_GEO/Y_GEO`; 8 ubigeos inferidos por nombre |
| Peligros geológicos | capas 0 y 1 (37,826) | **37,367** | 459 excluidos porque la fuente los marca `NoMostrarWEB`; 1,485 marcados `en_revision`; 7,597 con subtipo fuera del diccionario oficial (se usa el tipo) |

Detalle de qué falta y por qué en [`LIMITATIONS.md`](LIMITATIONS.md). Lo aprendido de la fuente está en [`RESEARCH.md`](RESEARCH.md).

## Usar los datos directamente

`data/zonas-criticas.geojson` y `data/peligros.geojson` son GeoJSON (WGS84, un feature por línea) y `data/metadata.json` tiene la fecha de captura, los conteos, las exclusiones y el sha256 de cada archivo. El esquema de cada registro se obtiene con `peligros-pe schema cerca`.

## Desarrollo

```bash
bun install
bun test                   # tests con registros reales de la fuente
bun run typecheck && bun run lint
bun run actualizar --dry-run   # descarga y valida sin escribir
bun run actualizar             # regenera data/
bun run build                  # dist/cli.js (corre en Node >= 20)
```

`actualizar` no escribe nada si un registro no valida el esquema, si faltan entidades en la descarga o si el número de registros cae más de 10 % frente a la captura anterior (`--forzar` para aceptar un cambio real). Un workflow semanal abre un PR con la nueva captura.

Bloques de [cligentic](https://github.com/Railly/cligentic) (MIT) copiados en `src/agent`, `src/foundation` y `src/platform`.

## Licencia

Código: MIT. Datos: INGEMMET, que no declara licencia en el servicio. Atribuye siempre a INGEMMET – GEOCATMIN y enlaza el boletín de cada registro.

---
name: peligros-pe
description: Consulta el inventario oficial de peligros geológicos y zonas críticas del Perú (INGEMMET) cerca de una ubicación. Úsalo cuando alguien pregunte si su casa, barrio o una coordenada en el Perú está cerca de huaicos, deslizamientos, inundaciones, derrumbes u otras zonas de peligro inventariadas.
---

# peligros-pe

CLI que responde "¿qué peligros inventariados hay cerca de este punto?" con datos del INGEMMET. Funciona sin conexión.

## Flujo

1. Consigue **coordenadas** (lat/lon WGS84). En asentamientos humanos las direcciones casi nunca geocodifican bien: pide la ubicación compartida o un punto en el mapa antes que una dirección.
2. Consulta (si no está instalado globalmente, antepone `npx @osrcmap/` a cada comando `peligros-pe`, también a los de `next-step`):
   ```bash
   peligros-pe cerca --lat <lat> --lon <lon> --json
   ```
   Opcional: `--radio <m>` (por defecto 2000), `--tipo huaico,inundacion`, `--capa zonas_criticas`.
3. Si hace falta, profundiza con los comandos de `next-step` que llegan por stderr:
   - `peligros-pe zona <id>`: detalle y enlace al boletín técnico.
   - `peligros-pe listar --ubigeo <ubigeo>`: todo el distrito, incluidas zonas sin coordenadas.
4. ¿Dudas sobre la entrada? `peligros-pe schema cerca --json`.

## Cómo responder al usuario

- **Siempre** cita la fuente y la fecha (`datos.fuente`, `datos.fecha_captura`) y transmite el `aviso`.
- **Nunca** digas que un lugar "es seguro" porque no haya registros: el inventario es parcial.
- **Nunca** des órdenes de evacuación ni inventes alertas. Para la situación actual, remite a INDECI, SENAMHI y la municipalidad.
- Prioriza `zonas_criticas` (zonas que INGEMMET considera prioritarias) y la categoría `flujo` (huaicos) en temporada de lluvias.
- Si `sin_coordenadas_en_distritos_cercanos` no está vacío, menciónalo: son zonas críticas del distrito cuya ubicación exacta no se conoce.
- Las distancias son al punto de referencia del registro, no al borde del área que puede afectar.

## Errores

La respuesta es `{"ok": false, "code", "error", "hint"}`. Sigue el `hint`.
- `FUERA_DE_COBERTURA`: casi siempre lat/lon invertidos. La latitud del Perú va de -18.5 a 0.1.
- `DATOS_VACIOS`: no hay datos. **No** lo interpretes como "no hay peligro".
- `ARGS_INVALIDOS`: revisa `schema <comando>`.

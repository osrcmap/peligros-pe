// Descarga el inventario de GEOCATMIN, lo normaliza, lo valida y escribe data/.
//
//   bun run actualizar               escribe data/
//   bun run actualizar --dry-run     descarga y valida, no escribe
//   bun run actualizar --forzar      publica aunque el conteo caiga más del umbral
//   bun run actualizar --salida dir  escribe en otro directorio
//
// Imprime un reporte JSON en stdout. Sale con código 1 si algo no cuadra:
// en ese caso no escribe nada (mejor datos viejos y correctos que nuevos y rotos).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { z } from "zod";
import { ARCHIVOS, DIR_DATOS, type Metadata, sha256 } from "../src/datos.js";
import { atomicWrite } from "../src/foundation/atomic-write.js";
import { CAPAS, descargarCapa, dominios, SERVICIO } from "../src/geocatmin.js";
import {
  type Feature,
  featureDe,
  inferirUbigeos,
  normalizarPeligro,
  normalizarZona,
  Peligro,
  ZonaCritica,
} from "../src/normalizar.js";

/** Caída máxima tolerada en el número de registros frente a la captura anterior. */
const CAIDA_MAXIMA = 0.1;

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    forzar: { type: "boolean", default: false },
    salida: { type: "string" },
  },
});
const dir = values.salida ?? DIR_DATOS;

function validar<P>(features: Feature<P>[], esquema: z.ZodType, nombre: string) {
  const errores: string[] = [];
  for (const f of features) {
    const r = esquema.safeParse(f);
    if (!r.success)
      errores.push(`${f.id}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  const ids = new Set(features.map((f) => f.id));
  if (ids.size !== features.length) errores.push(`${features.length - ids.size} ids duplicados`);
  if (errores.length) {
    throw new Error(
      `${nombre}: ${errores.length} registros inválidos. Primeros:\n${errores.slice(0, 10).join("\n")}`,
    );
  }
}

// Un feature por línea: diffs legibles en git.
const geojson = (features: Feature<unknown>[]) =>
  `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(",\n")}\n]}\n`;

const porId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

async function main() {
  const fechaCaptura = new Date().toISOString();
  const [domPeligros, domOtros] = await Promise.all([
    dominios(CAPAS.peligros),
    dominios(CAPAS.otros_peligros),
  ]);
  const crudosZonas = await descargarCapa(CAPAS.zonas_criticas);
  const crudosPeligros = await descargarCapa(CAPAS.peligros);
  const crudosOtros = await descargarCapa(CAPAS.otros_peligros);

  const zonas = crudosZonas.map(normalizarZona).sort(porId);

  const excluidos: Record<string, number> = {};
  const peligros: Feature<Peligro>[] = [];
  const fuentes = [
    [crudosPeligros, "Peligros Geológicos", domPeligros],
    [crudosOtros, "Otros Peligros Geológicos", domOtros],
  ] as const;
  for (const [crudos, origen, dom] of fuentes) {
    for (const f of crudos) {
      const r = normalizarPeligro(f, origen, dom);
      if ("excluido" in r) excluidos[r.excluido] = (excluidos[r.excluido] ?? 0) + 1;
      else peligros.push(r);
    }
  }
  peligros.sort(porId);

  const ubigeosInferidos = inferirUbigeos([...zonas, ...peligros].map((f) => f.properties));

  validar(zonas, featureDe(ZonaCritica), "zonas_criticas");
  validar(peligros, featureDe(Peligro), "peligros");

  // Protección contra descargas vacías o incompletas.
  const rutaMeta = join(dir, ARCHIVOS.metadata);
  const previa: Metadata | null = existsSync(rutaMeta) ? JSON.parse(readFileSync(rutaMeta, "utf8")) : null;
  const problemas: string[] = [];
  for (const [nombre, n] of [
    ["zonas_criticas", zonas.length],
    ["peligros", peligros.length],
  ] as const) {
    if (n === 0) problemas.push(`${nombre}: 0 registros`);
    const antes = previa?.conjuntos[nombre]?.publicados;
    if (antes && n < antes * (1 - CAIDA_MAXIMA)) {
      problemas.push(`${nombre}: cayó de ${antes} a ${n} (más de ${CAIDA_MAXIMA * 100} %)`);
    }
  }
  if (problemas.length && !values.forzar) {
    throw new Error(
      `Captura rechazada:\n${problemas.join("\n")}\nRevisa la fuente; usa --forzar solo si el cambio es real.`,
    );
  }

  const contenido = { zonas_criticas: geojson(zonas), peligros: geojson(peligros) };
  const sinCoordenadas = (fs: Feature<unknown>[]) => fs.filter((f) => !f.geometry).length;
  const metadata: Metadata = {
    version_esquema: 1,
    fecha_captura: fechaCaptura,
    fuente: {
      nombre: "INGEMMET – GEOCATMIN, servicio SERV_PELIGROS_GEOLOGICOS",
      url: SERVICIO,
      licencia: "No declarada por la fuente (ver LIMITATIONS.md)",
    },
    conjuntos: {
      zonas_criticas: {
        archivo: ARCHIVOS.zonas_criticas,
        capas_fuente: [CAPAS.zonas_criticas],
        registros_fuente: crudosZonas.length,
        publicados: zonas.length,
        excluidos: {},
        sin_coordenadas: sinCoordenadas(zonas),
        sha256: sha256(contenido.zonas_criticas),
      },
      peligros: {
        archivo: ARCHIVOS.peligros,
        capas_fuente: [CAPAS.peligros, CAPAS.otros_peligros],
        registros_fuente: crudosPeligros.length + crudosOtros.length,
        publicados: peligros.length,
        excluidos,
        sin_coordenadas: sinCoordenadas(peligros),
        sha256: sha256(contenido.peligros),
      },
    },
  };

  const reporte = {
    ok: true,
    dry_run: values["dry-run"],
    directorio: dir,
    fecha_captura: fechaCaptura,
    conjuntos: metadata.conjuntos,
    cambios_vs_anterior: previa
      ? {
          zonas_criticas: zonas.length - previa.conjuntos.zonas_criticas.publicados,
          peligros: peligros.length - previa.conjuntos.peligros.publicados,
        }
      : null,
    calidad: {
      zonas_coordenadas_recuperadas: zonas.filter((f) => f.properties.coordenadas_origen === "x_geo_y_geo")
        .length,
      ubigeos_inferidos_por_nombre: ubigeosInferidos,
      zonas_categoria_otro: zonas.filter((f) => f.properties.categorias.includes("otro")).length,
      peligros_categoria_otro: peligros.filter((f) => f.properties.categorias.includes("otro")).length,
      peligros_subtipo_sin_decodificar: peligros.filter(
        (f) => f.properties.codigo_peligro?.split("|").length === 3 && !f.properties.subtipo,
      ).length,
      peligros_en_revision: peligros.filter((f) => f.properties.en_revision).length,
    },
    advertencias: problemas,
  };

  if (!values["dry-run"]) {
    atomicWrite(join(dir, ARCHIVOS.zonas_criticas), contenido.zonas_criticas);
    atomicWrite(join(dir, ARCHIVOS.peligros), contenido.peligros);
    // metadata al final: si algo falla antes, los hashes no coinciden y `doctor` lo detecta.
    atomicWrite(rutaMeta, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(reporte, null, 2)}\n`);
}

main().catch((e) => {
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })}\n`,
  );
  process.exitCode = 1;
});

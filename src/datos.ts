// Carga del inventario publicado en data/.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fallo } from "./errores.js";
import type { Feature, Peligro, ZonaCritica } from "./normalizar.js";

// Relativo a src/ y a dist/: ambos están un nivel debajo de la raíz del paquete.
export const DIR_DATOS = fileURLToPath(new URL("../data/", import.meta.url));

export const ARCHIVOS = {
  zonas_criticas: "zonas-criticas.geojson",
  peligros: "peligros.geojson",
  metadata: "metadata.json",
} as const;

export type Conjunto = "zonas_criticas" | "peligros";

export type Metadata = {
  version_esquema: number;
  fecha_captura: string;
  fuente: { nombre: string; url: string; licencia: string };
  conjuntos: Record<
    Conjunto,
    {
      archivo: string;
      capas_fuente: number[];
      registros_fuente: number;
      publicados: number;
      excluidos: Record<string, number>;
      sin_coordenadas: number;
      sha256: string;
    }
  >;
};

export type Datos = {
  dir: string;
  metadata: Metadata;
  zonas_criticas: Feature<ZonaCritica>[];
  peligros: Feature<Peligro>[];
};

export const sha256 = (contenido: string | Buffer) => createHash("sha256").update(contenido).digest("hex");

function leerJson(ruta: string): any {
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch (e) {
    throw fallo("DATOS_NO_ENCONTRADOS", `No se pudo leer ${ruta}.`, e);
  }
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw fallo("DATOS_INVALIDOS", `${ruta} no es JSON válido.`, e);
  }
}

function leerColeccion(ruta: string): any[] {
  const fc = leerJson(ruta);
  if (fc?.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw fallo("DATOS_INVALIDOS", `${ruta} no es un GeoJSON FeatureCollection.`);
  }
  return fc.features;
}

export function cargarDatos(dir: string = DIR_DATOS): Datos {
  const metadata = leerJson(join(dir, ARCHIVOS.metadata));
  if (typeof metadata?.fecha_captura !== "string" || !metadata.conjuntos) {
    throw fallo("DATOS_INVALIDOS", `${join(dir, ARCHIVOS.metadata)} no tiene el formato esperado.`);
  }
  return {
    dir,
    metadata,
    zonas_criticas: leerColeccion(join(dir, ARCHIVOS.zonas_criticas)),
    peligros: leerColeccion(join(dir, ARCHIVOS.peligros)),
  };
}

export const diasDesde = (iso: string, ahora = Date.now()) =>
  Math.floor((ahora - Date.parse(iso)) / 86_400_000);

/** Bloque de procedencia que acompaña toda respuesta con registros. */
export function procedencia(datos: Datos) {
  const m = datos.metadata;
  return {
    fuente: m.fuente.nombre,
    url: m.fuente.url,
    fecha_captura: m.fecha_captura,
    dias_desde_captura: diasDesde(m.fecha_captura),
  };
}

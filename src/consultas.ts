import distance from "@turf/distance";
import type { Categoria, Feature } from "./normalizar.js";

type ConCategorias = { categorias: Categoria[]; ubigeo: string | null; id: string };

export type ConDistancia<P> = P & { distancia_m: number; lat: number; lon: number };
export type ConUbicacion<P> = P & { lat: number | null; lon: number | null };

const coincide = (cats: Categoria[], filtro?: Categoria[]) =>
  !filtro?.length || cats.some((c) => filtro.includes(c));

/** Registros a <= radioM metros de (lat, lon), del más cercano al más lejano. Ignora los sin coordenadas. */
export function cerca<P extends ConCategorias>(
  features: Feature<P>[],
  lat: number,
  lon: number,
  radioM: number,
  categorias?: Categoria[],
): ConDistancia<P>[] {
  const origen = [lon, lat];
  const out: ConDistancia<P>[] = [];
  for (const f of features) {
    if (!f.geometry || !coincide(f.properties.categorias, categorias)) continue;
    const [flon, flat] = f.geometry.coordinates;
    const d = distance(origen, [flon, flat], { units: "meters" });
    if (d <= radioM) out.push({ ...f.properties, distancia_m: Math.round(d), lat: flat, lon: flon });
  }
  return out.sort((a, b) => a.distancia_m - b.distancia_m);
}

/** Registros cuyo ubigeo empieza con `prefijo` (2, 4 o 6 dígitos). Incluye los que no tienen coordenadas. */
export function listar<P extends ConCategorias>(
  features: Feature<P>[],
  prefijo: string,
  categorias?: Categoria[],
): ConUbicacion<P>[] {
  return features
    .filter((f) => f.properties.ubigeo?.startsWith(prefijo) && coincide(f.properties.categorias, categorias))
    .map((f) => conUbicacion(f))
    .sort((a, b) => (a.ubigeo ?? "").localeCompare(b.ubigeo ?? "") || a.id.localeCompare(b.id));
}

export const conUbicacion = <P>(f: Feature<P>): ConUbicacion<P> => ({
  ...f.properties,
  lat: f.geometry?.coordinates[1] ?? null,
  lon: f.geometry?.coordinates[0] ?? null,
});

/** Cuenta registros por categoría (un registro puede sumar a varias). */
export function porCategoria(registros: { categorias: Categoria[] }[]) {
  const n: Partial<Record<Categoria, number>> = {};
  for (const r of registros) for (const c of r.categorias) n[c] = (n[c] ?? 0) + 1;
  return n;
}

// Esquemas de los datos publicados y normalización desde los registros crudos de GEOCATMIN.
import { z } from "zod";
import type { Dominios } from "./geocatmin.js";

/** Rectángulo que contiene al Perú (con margen). Fuera de él, una coordenada es un error. */
export const BBOX_PERU = { oeste: -81.5, este: -68.5, sur: -18.5, norte: 0.1 } as const;

export const enPeru = (lon: number, lat: number) =>
  Number.isFinite(lon) &&
  Number.isFinite(lat) &&
  lon >= BBOX_PERU.oeste &&
  lon <= BBOX_PERU.este &&
  lat >= BBOX_PERU.sur &&
  lat <= BBOX_PERU.norte;

export const CATEGORIAS = [
  "flujo",
  "deslizamiento",
  "caida",
  "inundacion",
  "erosion",
  "reptacion",
  "hundimiento",
  "arenamiento",
  "movimiento_complejo",
  "otro",
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

// "flujo" incluye huaicos (flujos de detritos/lodo), aluviones y avalanchas.
// "fujo" e "inundac" cubren erratas reales de la fuente ("Fujo de detritos", "Inundacón fluvial").
const PALABRAS: [Categoria, string[]][] = [
  ["flujo", ["flujo", "fujo", "huaico", "huayco", "aluvion", "avalancha", "lahar", "inundacion de detritos"]],
  ["deslizamiento", ["deslizamiento", "desplazamiento lateral"]],
  ["caida", ["caida", "derrumbe", "alud", "vuelco", "desprendimiento"]],
  ["inundacion", ["inundac", "anegamiento"]],
  ["erosion", ["erosion", "socavamiento", "carcava"]],
  ["reptacion", ["reptacion"]],
  ["hundimiento", ["hundimiento", "subsidencia"]],
  ["arenamiento", ["arenamiento"]],
  ["movimiento_complejo", ["complejo"]],
];

export const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// ponytail: clasificación por palabras clave sobre el texto oficial (que se conserva tal cual).
// Si aparece texto que cae en "otro", ampliar PALABRAS; `actualizar` reporta cuántos hay.
export function categorizar(...textos: (string | null)[]): Categoria[] {
  const t = sinTildes(textos.filter(Boolean).join(" "));
  const cats = PALABRAS.filter(([, ps]) => ps.some((p) => t.includes(p))).map(([c]) => c);
  return cats.length ? cats : ["otro"];
}

// ---------- Esquemas publicados ----------

const texto = z.string().min(1).nullable();

const ubicacion = {
  departamento: texto,
  provincia: texto,
  distrito: texto,
  ubigeo: z
    .string()
    .regex(/^\d{6}$/)
    .nullable(),
  ubigeo_origen: z.enum(["fuente", "inferido_por_nombre"]).nullable(),
};

export const ZonaCritica = z.object({
  id: z.string().regex(/^zc-[0-9a-f-]{36}$/),
  capa: z.literal("zonas_criticas"),
  objectid: z.number().int(),
  peligro: texto.describe("Texto oficial del tipo de peligro (campo PELIGROS_G)"),
  categorias: z.array(z.enum(CATEGORIAS)).min(1),
  paraje: texto,
  ...ubicacion,
  elementos_expuestos: texto,
  recomendacion: texto,
  boletin: texto,
  url_boletin: z.url().nullable(),
  proyecto: texto,
  coordenadas_origen: z.enum(["geometria", "x_geo_y_geo"]).nullable(),
});
export type ZonaCritica = z.infer<typeof ZonaCritica>;

export const Peligro = z.object({
  id: z.string().regex(/^pg-[0-9a-f-]{36}$/),
  capa: z.literal("peligros"),
  capa_origen: z.enum(["Peligros Geológicos", "Otros Peligros Geológicos"]),
  objectid: z.number().int(),
  codigo_inventario: texto,
  grupo: texto.describe("Movimientos en masa, Geohidrológicos, ..."),
  tipo: texto,
  subtipo: texto,
  codigo_peligro: texto.describe("Código original (NOM_PELIGRO o TIP_PELIGRO)"),
  categorias: z.array(z.enum(CATEGORIAS)).min(1),
  sector: texto,
  ...ubicacion,
  altura_msnm: z.number().int().min(0).max(7000).nullable(),
  fecha: z.iso.date().nullable(),
  elementos_expuestos: texto,
  factores_detonantes: z.array(z.string()),
  fuentes_informacion: z.array(z.string()),
  estudio: texto,
  en_revision: z.boolean(),
});
export type Peligro = z.infer<typeof Peligro>;

const Punto = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]).refine(([lon, lat]) => enPeru(lon, lat), "fuera del Perú"),
});

export const featureDe = <T extends z.ZodType>(props: T) =>
  z.object({ type: z.literal("Feature"), id: z.string(), geometry: Punto.nullable(), properties: props });

export type Feature<P> = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: P;
};

// ---------- Normalización ----------

/** Texto limpio o null (vacíos, espacios y marcadores de error de la fuente → null). */
export const limpio = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== "--error--" ? s : null;
};

const ubigeoValido = (v: unknown) => {
  const s = limpio(v);
  return s && /^\d{6}$/.test(s) ? s : null;
};

const guid = (g: unknown) => String(g).replace(/[{}]/g, "").toLowerCase();
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function punto(
  geom: any,
  alterno?: [unknown, unknown],
): Pick<Feature<unknown>, "geometry"> & {
  origen: "geometria" | "x_geo_y_geo" | null;
} {
  const c = geom?.coordinates;
  if (Array.isArray(c) && c.length === 2 && enPeru(c[0], c[1])) {
    return { geometry: { type: "Point", coordinates: [r6(c[0]), r6(c[1])] }, origen: "geometria" };
  }
  const [x, y] = alterno ?? [];
  if (typeof x === "number" && typeof y === "number" && enPeru(x, y)) {
    return { geometry: { type: "Point", coordinates: [r6(x), r6(y)] }, origen: "x_geo_y_geo" };
  }
  return { geometry: null, origen: null };
}

/** Decodifica un campo con dominio; acepta listas "a,b". Códigos desconocidos se omiten. */
function decodificar(dom: Dominios, campo: string, valor: unknown): string[] {
  const s = limpio(valor);
  if (!s) return [];
  const nombres = s
    .split(",")
    .map((c) => dom[campo]?.[c.trim()])
    .filter((n): n is string => Boolean(n));
  return [...new Set(nombres)];
}

function fechaIso(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  // ponytail: las fechas llegan como medianoche local (05:00Z) o 00:00Z; la fecha UTC es la correcta en ambos casos.
  const d = new Date(ms);
  const anio = d.getUTCFullYear();
  return anio >= 1900 && anio <= new Date().getUTCFullYear() + 1 ? d.toISOString().slice(0, 10) : null;
}

export function normalizarZona(f: any): Feature<ZonaCritica> {
  const p = f.properties;
  const { geometry, origen } = punto(f.geometry, [p.X_GEO, p.Y_GEO]);
  const peligro = limpio(p.PELIGROS_G);
  const ubigeo = ubigeoValido(p.CD_DIST);
  const id = `zc-${guid(p.GLOBALID)}`;
  return {
    type: "Feature",
    id,
    geometry,
    properties: {
      id,
      capa: "zonas_criticas",
      objectid: p.OBJECTID,
      peligro,
      categorias: categorizar(peligro),
      paraje: limpio(p.PARAJE),
      departamento: limpio(p.NM_DEPA) ?? limpio(p.REGION),
      provincia: limpio(p.NM_PROV) ?? limpio(p.PROVINCIA),
      distrito: limpio(p.NM_DIST) ?? limpio(p.DISTRITO),
      ubigeo,
      ubigeo_origen: ubigeo ? "fuente" : null,
      elementos_expuestos: limpio(p.ELEMENTO),
      recomendacion: limpio(p.RECOMEND) ?? limpio(p.RECOMEND_1),
      boletin: limpio(p.BOLETIN),
      url_boletin: /^https?:\/\//.test(limpio(p.URL_BOLETIN) ?? "") ? limpio(p.URL_BOLETIN) : null,
      proyecto: limpio(p.PROYECTO),
      coordenadas_origen: origen,
    },
  };
}

/** Estados de REGISTRO que el INGEMMET marca como publicables. "Revision" se publica con `en_revision`. */
const REGISTRO_PUBLICABLE = new Set(["Publicable", "Validado", "Revision"]);

export type Excluido = { excluido: string };

export function normalizarPeligro(
  f: any,
  capaOrigen: Peligro["capa_origen"],
  dom: Dominios,
): Feature<Peligro> | Excluido {
  const p = f.properties;
  const registro = limpio(p.REGISTRO) ?? "sin_registro";
  if (!REGISTRO_PUBLICABLE.has(registro)) return { excluido: registro };

  const { geometry } = punto(f.geometry);
  const tipo = decodificar(dom, "TIP_PELIGRO", p.TIP_PELIGRO)[0] ?? null;
  const subtipo = decodificar(dom, "NOM_PELIGRO", p.NOM_PELIGRO)[0] ?? null;
  const ubigeo = ubigeoValido(p.UBIGEO);
  const altura =
    typeof p.ALTURA === "number" && p.ALTURA >= 0 && p.ALTURA <= 7000 ? Math.round(p.ALTURA) : null;
  const id = `pg-${guid(p.GLOBALID)}`;
  return {
    type: "Feature",
    id,
    geometry,
    properties: {
      id,
      capa: "peligros",
      capa_origen: capaOrigen,
      objectid: p.OBJECTID,
      codigo_inventario: limpio(p.COD_INV),
      grupo: decodificar(dom, "COD_PELIGRO", p.COD_PELIGRO)[0] ?? null,
      tipo,
      subtipo,
      codigo_peligro: limpio(p.NOM_PELIGRO) ?? limpio(p.TIP_PELIGRO),
      categorias: categorizar(tipo, subtipo),
      sector: limpio(p.NM_SECTOR),
      departamento: limpio(p.NM_DPTO),
      provincia: limpio(p.NM_PROV),
      distrito: limpio(p.NM_DIST),
      ubigeo,
      ubigeo_origen: ubigeo ? "fuente" : null,
      altura_msnm: altura,
      fecha: fechaIso(p.FECHA),
      elementos_expuestos: limpio(p.RE_ME_E_NE),
      factores_detonantes: decodificar(dom, "FACT_GEOGR", p.FACT_GEOGR),
      fuentes_informacion: decodificar(dom, "FUENTE", p.FUENTE),
      estudio: limpio(p.TIESTU_ANO)?.replace(/\s+/g, " ") ?? null,
      en_revision: registro === "Revision",
    },
  };
}

type ConUbicacion = Pick<ZonaCritica, "departamento" | "provincia" | "distrito" | "ubigeo" | "ubigeo_origen">;
const claveLugar = (p: ConUbicacion) =>
  p.departamento && p.provincia && p.distrito
    ? [p.departamento, p.provincia, p.distrito].map(sinTildes).join("|")
    : null;

/**
 * Completa el ubigeo faltante buscando registros con el mismo departamento,
 * provincia y distrito (sin tildes ni mayúsculas). Solo si la coincidencia es única.
 * Devuelve cuántos se completaron.
 */
export function inferirUbigeos(registros: ConUbicacion[]): number {
  const porLugar = new Map<string, Set<string>>();
  for (const p of registros) {
    const k = claveLugar(p);
    if (k && p.ubigeo && p.ubigeo_origen === "fuente") {
      porLugar.set(k, (porLugar.get(k) ?? new Set()).add(p.ubigeo));
    }
  }
  let n = 0;
  for (const p of registros) {
    if (p.ubigeo) continue;
    const k = claveLugar(p);
    const candidatos = k ? porLugar.get(k) : undefined;
    if (candidatos?.size === 1) {
      p.ubigeo = [...candidatos][0];
      p.ubigeo_origen = "inferido_por_nombre";
      n++;
    }
  }
  return n;
}

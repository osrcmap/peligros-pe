import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { renderDoctor, runDoctor } from "./agent/doctor.js";
import { detectMode, type EmitOptions, emit } from "./agent/json-mode.js";
import { emitNextSteps, type NextStep } from "./agent/next-steps.js";
import { cerca, conUbicacion, listar, porCategoria } from "./consultas.js";
import { ARCHIVOS, type Conjunto, cargarDatos, type Datos, diasDesde, procedencia, sha256 } from "./datos.js";
import { ERRORES, exitCode, fallo } from "./errores.js";
import { AppError } from "./foundation/error-map.js";
import { CAPAS, contar } from "./geocatmin.js";
import { CATEGORIAS, enPeru, Peligro, ZonaCritica } from "./normalizar.js";

/** Días a partir de los cuales `doctor` considera viejos los datos. */
const DIAS_FRESCURA = 45;

const AVISO = [
  "Información de referencia del inventario del INGEMMET. No es una alerta ni una orden de evacuación.",
  "Que no aparezcan registros cerca NO significa que el lugar sea seguro: el inventario no cubre todo el territorio.",
  "Cada registro es un punto de referencia; un huaico, deslizamiento o inundación puede afectar un área mayor que el radio consultado.",
  "Ante lluvias intensas o una emergencia, sigue las indicaciones oficiales de INDECI, SENAMHI y tu municipalidad.",
];

// ---------- Entradas (validación + `schema`) ----------

const aNumero = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);
// "huaico"/"huayco" es como la gente llama a los flujos: lo aceptamos como alias.
const ALIAS: Record<string, string> = {
  huaico: "flujo",
  huayco: "flujo",
  huaicos: "flujo",
  huaycos: "flujo",
};
const aLista = (v: unknown) =>
  (typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : [v])
    .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : s))
    .filter((s) => s !== "" && s !== undefined)
    .map((s) => ALIAS[s as string] ?? s);
const aTexto = (v: unknown) => (typeof v === "number" ? String(v) : v);

const capa = z
  .enum(["todas", "zonas_criticas", "peligros"])
  .default("todas")
  .describe(
    "zonas_criticas: ~2,200 zonas priorizadas por INGEMMET. peligros: ~37,000 eventos inventariados.",
  );
const tipo = z
  .preprocess((v) => (v === undefined ? v : aLista(v)), z.array(z.enum(CATEGORIAS)).min(1).optional())
  .describe(
    "Filtra por categoría (separadas por coma). 'flujo' incluye huaicos; 'huaico' se acepta como alias.",
  );
const limite = z
  .preprocess(aNumero, z.number().int().min(1).max(1000).default(50))
  .describe("Máximo de registros por capa en la respuesta (los totales siempre se informan).");

const ENTRADAS = {
  cerca: z.strictObject({
    lat: z.preprocess(aNumero, z.number().min(-90).max(90)).describe("Latitud WGS84 (Perú: -18.5 a 0.1)"),
    lon: z
      .preprocess(aNumero, z.number().min(-180).max(180))
      .describe("Longitud WGS84 (Perú: -81.5 a -68.5)"),
    radio: z
      .preprocess(aNumero, z.number().min(1).max(50_000).default(2000))
      .describe("Metros. Se mide al punto de referencia de cada registro, no al borde del área afectada."),
    capa,
    tipo,
    limite,
  }),
  listar: z.strictObject({
    ubigeo: z
      .preprocess(aTexto, z.string().regex(/^\d{2}(\d{2}(\d{2})?)?$/, "2, 4 o 6 dígitos"))
      .describe("Ubigeo INEI: 2 dígitos (departamento), 4 (provincia) o 6 (distrito). Ej: 150118"),
    capa,
    tipo,
    limite,
  }),
  zona: z.strictObject({
    id: z
      .string()
      .regex(/^(zc|pg)-[0-9a-f-]{36}$/, "id con formato zc-… o pg-…")
      .describe("Id de `cerca`/`listar`"),
  }),
  schema: z.strictObject({
    comando: z.enum(["cerca", "listar", "zona", "schema", "doctor"]).optional(),
  }),
  doctor: z.strictObject({
    "sin-red": z.boolean().default(false).describe("No consultar GEOCATMIN"),
  }),
};
type Comando = keyof typeof ENTRADAS;

const DESCRIPCIONES: Record<Comando, string> = {
  cerca: "Zonas críticas y peligros inventariados a menos de --radio metros de un punto.",
  listar:
    "Registros de un departamento, provincia o distrito (por ubigeo). Incluye los que no tienen coordenadas.",
  zona: "Detalle de un registro por id.",
  schema: "Describe entradas y salidas de un comando (JSON Schema).",
  doctor: "Revisa datos locales (presencia, integridad, antigüedad) y la disponibilidad de la fuente.",
};

const SALIDAS: Record<Comando, string> = {
  cerca:
    "{ ok, consulta, resumen: { zonas_criticas, peligros, por_categoria, mas_cercano_m }, zonas_criticas: Registro[] (+distancia_m, lat, lon), peligros: Registro[], truncado, sin_coordenadas_en_distritos_cercanos: ZonaCritica[], datos, aviso: string[] }",
  listar:
    "{ ok, consulta, total, resultados: Registro[] (+lat, lon; null si no tiene coordenadas), truncado, datos, aviso }",
  zona: "{ ok, registro: Registro (+lat, lon), datos, aviso }",
  schema: "{ ok, comandos } o { ok, comando, descripcion, entrada, salida, registros }",
  doctor: "{ ok, checks: { name, ok, detail }[] }",
};

// ---------- Utilidades ----------

function leerParams(v: string | undefined): Record<string, unknown> {
  if (!v) return {};
  let p: unknown;
  try {
    p = JSON.parse(v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v);
  } catch (e) {
    throw fallo("PARAMS_INVALIDOS", `No se pudo leer --params ${v}.`, e);
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw fallo("PARAMS_INVALIDOS", "--params debe ser un objeto JSON.");
  return p as Record<string, unknown>;
}

/**
 * Las coordenadas del Perú son negativas y parseArgs toma "-12.05" como otra opción.
 * Unimos "--lat -12.05" en "--lat=-12.05".
 */
export function unirNegativos(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && !a.includes("=") && /^-\d/.test(argv[i + 1] ?? "")) {
      out.push(`${a}=${argv[++i]}`);
    } else out.push(a);
  }
  return out;
}

function exigirDatos(datos: Datos, conjuntos: Conjunto[]) {
  if (conjuntos.every((c) => datos[c].length === 0)) {
    throw fallo("DATOS_VACIOS", `No hay registros cargados en ${conjuntos.join(" ni ")}.`);
  }
}

const conjuntosDe = (c: "todas" | Conjunto): Conjunto[] =>
  c === "todas" ? ["zonas_criticas", "peligros"] : [c];

type Resultado = {
  valor: Record<string, unknown>;
  pasos?: NextStep[];
  humano?: () => void;
  fallido?: boolean;
};

const linea = (r: any) =>
  [
    `${String(r.distancia_m ?? "").padStart(6)}${r.distancia_m !== undefined ? " m" : ""}`,
    r.peligro ?? r.subtipo ?? r.tipo ?? "(sin tipo)",
    "—",
    r.paraje ?? r.sector ?? "",
    `(${[r.distrito, r.provincia, r.departamento].filter(Boolean).join(", ")})`,
    r.lat === null ? "[SIN COORDENADAS]" : "",
  ]
    .filter(Boolean)
    .join(" ");

// ---------- Comandos ----------

function cmdCerca(e: z.infer<typeof ENTRADAS.cerca>, datos: Datos): Resultado {
  if (!enPeru(e.lon, e.lat)) throw fallo("FUERA_DE_COBERTURA", `(${e.lat}, ${e.lon}) está fuera del Perú.`);
  const conjuntos = conjuntosDe(e.capa);
  exigirDatos(datos, conjuntos);

  const zc = conjuntos.includes("zonas_criticas")
    ? cerca(datos.zonas_criticas, e.lat, e.lon, e.radio, e.tipo)
    : [];
  const pg = conjuntos.includes("peligros") ? cerca(datos.peligros, e.lat, e.lon, e.radio, e.tipo) : [];

  // Zonas críticas sin coordenadas no pueden medirse: las mostramos si están en un distrito de los resultados.
  const distritos = new Set([...zc, ...pg].map((r) => r.ubigeo).filter(Boolean));
  const sinCoordenadas = datos.zonas_criticas
    .filter((f) => !f.geometry && f.properties.ubigeo && distritos.has(f.properties.ubigeo))
    .map(conUbicacion);

  const masCercano = [zc[0]?.distancia_m, pg[0]?.distancia_m].filter((d) => d !== undefined) as number[];
  const valor = {
    ok: true,
    consulta: e,
    resumen: {
      zonas_criticas: conjuntos.includes("zonas_criticas") ? zc.length : null,
      peligros: conjuntos.includes("peligros") ? pg.length : null,
      por_categoria: porCategoria([...zc, ...pg]),
      mas_cercano_m: masCercano.length ? Math.min(...masCercano) : null,
    },
    zonas_criticas: zc.slice(0, e.limite),
    peligros: pg.slice(0, e.limite),
    truncado: zc.length > e.limite || pg.length > e.limite,
    sin_coordenadas_en_distritos_cercanos: sinCoordenadas,
    datos: procedencia(datos),
    aviso: AVISO,
  };

  const cercano = [zc[0], pg[0]].filter(Boolean).sort((a, b) => a.distancia_m - b.distancia_m)[0];
  const pasos: NextStep[] = [];
  if (cercano) {
    pasos.push({
      command: `peligros-pe zona ${cercano.id}`,
      description: "Detalle y boletín del registro más cercano",
    });
    if (cercano.ubigeo) {
      pasos.push({
        command: `peligros-pe listar --ubigeo ${cercano.ubigeo}`,
        description: "Todo lo inventariado en ese distrito",
        optional: true,
      });
    }
  } else if (e.radio < 50_000) {
    pasos.push({
      command: `peligros-pe cerca --lat ${e.lat} --lon ${e.lon} --radio ${Math.min(e.radio * 5, 50_000)}`,
      description: "Ampliar el radio de búsqueda",
    });
  }
  if (valor.truncado) {
    pasos.push({
      command: `peligros-pe cerca --lat ${e.lat} --lon ${e.lon} --radio ${e.radio} --capa ${e.capa} --limite ${Math.min(Math.max(zc.length, pg.length), 1000)}`,
      description: "Ver todos los registros (la respuesta está truncada)",
      optional: true,
    });
  }

  const humano = () => {
    const out: string[] = [];
    const bloque = (titulo: string, rs: any[], total: number) => {
      out.push(`${titulo}: ${total}${total > rs.length ? ` (mostrando ${rs.length})` : ""}`);
      for (const r of rs) out.push(`  ${linea(r)}`);
    };
    out.push(`Consulta: (${e.lat}, ${e.lon}), radio ${e.radio} m`);
    if (conjuntos.includes("zonas_criticas")) bloque("Zonas críticas", valor.zonas_criticas, zc.length);
    if (conjuntos.includes("peligros")) bloque("Peligros inventariados", valor.peligros, pg.length);
    if (sinCoordenadas.length)
      bloque("Zonas críticas SIN coordenadas en estos distritos", sinCoordenadas, sinCoordenadas.length);
    const d = valor.datos;
    out.push(
      "",
      `Fuente: ${d.fuente}. Captura: ${d.fecha_captura.slice(0, 10)} (hace ${d.dias_desde_captura} días).`,
    );
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, pasos, humano };
}

function cmdListar(e: z.infer<typeof ENTRADAS.listar>, datos: Datos): Resultado {
  const conjuntos = conjuntosDe(e.capa);
  exigirDatos(datos, conjuntos);
  const rs = conjuntos.flatMap((c) => listar<any>(datos[c], e.ubigeo, e.tipo));
  const valor = {
    ok: true,
    consulta: e,
    total: rs.length,
    por_categoria: porCategoria(rs),
    resultados: rs.slice(0, e.limite),
    truncado: rs.length > e.limite,
    datos: procedencia(datos),
    aviso: AVISO,
  };
  const pasos: NextStep[] = rs[0]
    ? [{ command: `peligros-pe zona ${rs[0].id}`, description: "Detalle de un registro" }]
    : [];
  const humano = () => {
    const out = [
      `Ubigeo ${e.ubigeo}: ${rs.length} registros${rs.length > e.limite ? ` (mostrando ${e.limite})` : ""}`,
    ];
    for (const r of valor.resultados)
      out.push(`  ${r.capa === "zonas_criticas" ? "[ZC]" : "[PG]"} ${linea(r)}`);
    for (const a of AVISO) out.push(`! ${a}`);
    process.stdout.write(`${out.join("\n")}\n`);
  };
  return { valor, pasos, humano };
}

function cmdZona(e: z.infer<typeof ENTRADAS.zona>, datos: Datos): Resultado {
  const f = (e.id.startsWith("zc-") ? datos.zonas_criticas : datos.peligros).find((x) => x.id === e.id);
  if (!f) throw fallo("NO_ENCONTRADO", `No existe el registro ${e.id}.`);
  return { valor: { ok: true, registro: conUbicacion<object>(f), datos: procedencia(datos), aviso: AVISO } };
}

function cmdSchema(e: z.infer<typeof ENTRADAS.schema>): Resultado {
  if (!e.comando) {
    return {
      valor: {
        ok: true,
        comandos: Object.entries(DESCRIPCIONES).map(([nombre, descripcion]) => ({ nombre, descripcion })),
        flags_globales: {
          "--json": "Fuerza salida JSON (por defecto cuando stdout no es una terminal).",
          "--params": "Entrada como objeto JSON en línea o @archivo.json.",
          "--datos": "Directorio de datos alternativo.",
        },
      },
    };
  }
  const c = e.comando;
  return {
    valor: {
      ok: true,
      comando: c,
      descripcion: DESCRIPCIONES[c],
      entrada: z.toJSONSchema(ENTRADAS[c], { io: "input" }),
      salida: SALIDAS[c],
      registros: ["cerca", "listar", "zona"].includes(c)
        ? { zona_critica: z.toJSONSchema(ZonaCritica), peligro: z.toJSONSchema(Peligro) }
        : undefined,
    },
  };
}

async function cmdDoctor(e: z.infer<typeof ENTRADAS.doctor>, dir: string | undefined): Promise<Resultado> {
  let datos: Datos | null = null;
  let errorCarga = "";
  try {
    datos = cargarDatos(dir);
  } catch (err) {
    errorCarga = err instanceof Error ? err.message : String(err);
  }
  const conjuntos: Conjunto[] = ["zonas_criticas", "peligros"];

  const checks = [
    async () => ({
      name: "datos",
      ok: Boolean(datos && conjuntos.every((c) => datos[c].length > 0)),
      detail: datos
        ? `${conjuntos.map((c) => `${c}: ${datos[c].length}`).join(", ")} (en ${datos.dir})`
        : errorCarga,
    }),
    async () => {
      if (!datos) return { name: "integridad", ok: false, detail: "sin datos" };
      const malos = conjuntos.filter(
        (c) => sha256(readFileSync(join(datos.dir, ARCHIVOS[c]))) !== datos.metadata.conjuntos[c]?.sha256,
      );
      return {
        name: "integridad",
        ok: malos.length === 0,
        detail: malos.length
          ? `sha256 no coincide en: ${malos.join(", ")}`
          : "sha256 coincide con metadata.json",
      };
    },
    async () => {
      if (!datos) return { name: "frescura", ok: false, detail: "sin datos" };
      const dias = diasDesde(datos.metadata.fecha_captura);
      return {
        name: "frescura",
        ok: dias <= DIAS_FRESCURA,
        detail: `captura del ${datos.metadata.fecha_captura.slice(0, 10)} (hace ${dias} días; umbral ${DIAS_FRESCURA})`,
      };
    },
  ];
  if (!e["sin-red"]) {
    checks.push(async () => {
      const [zc, p0, p1] = await Promise.all([
        contar(CAPAS.zonas_criticas),
        contar(CAPAS.peligros),
        contar(CAPAS.otros_peligros),
      ]);
      const local = datos?.metadata.conjuntos;
      const iguales =
        local?.zonas_criticas.registros_fuente === zc && local?.peligros.registros_fuente === p0 + p1;
      return {
        name: "fuente",
        ok: Boolean(iguales),
        detail: `GEOCATMIN responde: ${zc} zonas críticas, ${p0 + p1} peligros${
          iguales ? " (igual que la captura local)" : " — distinto a la captura local; conviene actualizar"
        }`,
      };
    });
  }
  const r = await runDoctor(checks);
  const pasos: NextStep[] = r.ok
    ? []
    : [{ command: "bun run actualizar", description: "Regenerar datos desde GEOCATMIN (en el repo)" }];
  return { valor: r, pasos, fallido: !r.ok };
}

// ---------- Main ----------

const AYUDA = `peligros-pe ${pkg.version} — peligros geológicos y zonas críticas del Perú (INGEMMET)

Uso:
  peligros-pe cerca --lat -11.95 --lon -76.98 [--radio 2000] [--capa todas|zonas_criticas|peligros] [--tipo flujo,inundacion] [--limite 50]
  peligros-pe listar --ubigeo 150118 [--capa ...] [--tipo ...]
  peligros-pe zona <id>
  peligros-pe schema [comando]
  peligros-pe doctor [--sin-red]

Flags globales:
  --json             salida JSON (por defecto si stdout no es una terminal)
  --params <json>    entrada como objeto JSON o @archivo.json
  --datos <dir>      directorio de datos alternativo
  -h, --help         esta ayuda
  --version

Categorías para --tipo: ${CATEGORIAS.join(", ")}

Información de referencia: no es una alerta ni una orden de evacuación.
`;

async function main(argv: string[]) {
  let parsed: ReturnType<typeof parsear>;
  try {
    parsed = parsear(argv);
  } catch (e) {
    throw fallo("ARGS_INVALIDOS", e instanceof Error ? e.message : String(e), e);
  }
  const { values, positionals } = parsed;
  const opts: EmitOptions = { json: values.json };

  if (values.version) return emit({ ok: true, version: pkg.version }, opts, (v) => console.log(v.version));
  const comando = positionals[0];
  if (values.help || !comando) return void process.stdout.write(AYUDA);
  if (!(comando in ENTRADAS)) throw fallo("COMANDO_DESCONOCIDO", `Comando desconocido: ${comando}.`);
  const cmd = comando as Comando;

  const { json: _j, params, datos: dirDatos, help: _h, version: _v, ...flags } = values;
  const crudo: Record<string, unknown> = { ...leerParams(params) };
  for (const [k, v] of Object.entries(flags)) if (v !== undefined) crudo[k] = v;
  if (positionals[1] !== undefined) crudo[cmd === "zona" ? "id" : "comando"] = positionals[1];
  if (positionals.length > 2 || (positionals[1] !== undefined && !["zona", "schema"].includes(cmd))) {
    throw fallo("ARGS_INVALIDOS", `Argumentos de más: ${positionals.slice(1).join(" ")}`);
  }

  const entrada = ENTRADAS[cmd].safeParse(crudo);
  if (!entrada.success) throw fallo("ARGS_INVALIDOS", z.prettifyError(entrada.error));
  const e: any = entrada.data;

  let r: Resultado;
  if (cmd === "schema") r = cmdSchema(e);
  else if (cmd === "doctor") r = await cmdDoctor(e, dirDatos);
  else {
    const datos = cargarDatos(dirDatos);
    r = cmd === "cerca" ? cmdCerca(e, datos) : cmd === "listar" ? cmdListar(e, datos) : cmdZona(e, datos);
  }

  if (cmd === "doctor") renderDoctor(r.valor as any, opts);
  else emit(r.valor, opts, r.humano ? () => r.humano?.() : undefined);
  emitNextSteps(r.pasos ?? [], opts);
  if (r.fallido) process.exitCode = 1;
}

function parsear(argv: string[]) {
  return parseArgs({
    args: unirNegativos(argv),
    allowPositionals: true,
    strict: true,
    options: {
      lat: { type: "string" },
      lon: { type: "string" },
      radio: { type: "string" },
      capa: { type: "string" },
      tipo: { type: "string" },
      limite: { type: "string" },
      ubigeo: { type: "string" },
      "sin-red": { type: "boolean" },
      json: { type: "boolean" },
      params: { type: "string" },
      datos: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}

/** Punto de entrada (lo llama src/bin.ts). Nunca lanza: todo error sale estructurado con su exit code. */
export async function ejecutar(argv: string[]): Promise<void> {
  try {
    await main(argv);
  } catch (e: unknown) {
    const err =
      e instanceof AppError
        ? e
        : new AppError(
            "ERROR_INTERNO",
            { ...ERRORES.ERROR_INTERNO, human: e instanceof Error ? e.message : String(e) },
            e,
          );
    if (detectMode({ json: argv.includes("--json") }) === "json") {
      process.stdout.write(`${JSON.stringify(err.toJSON())}\n`);
    } else {
      process.stderr.write(`✗ ${err.human}\n${err.hint ? `  ${err.hint}\n` : ""}`);
    }
    process.exitCode = exitCode(err.code);
  }
}

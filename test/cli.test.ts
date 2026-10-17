import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unirNegativos } from "../src/cli.js";
import { ARCHIVOS, sha256 } from "../src/datos.js";
import {
  type Feature,
  inferirUbigeos,
  normalizarPeligro,
  normalizarZona,
  type Peligro,
} from "../src/normalizar.js";
import crudo from "./fixtures/crudo.json";

const CLI = join(import.meta.dir, "../src/bin.ts");

function correr(...args: string[]) {
  const r = Bun.spawnSync([process.execPath, CLI, ...args, "--json"]);
  const out = r.stdout.toString().trim();
  return { code: r.exitCode, json: out ? JSON.parse(out) : null };
}

/** Escribe un directorio de datos con el mismo formato que `actualizar`. */
function escribirDatos(zonas: Feature<unknown>[], peligros: Feature<unknown>[]) {
  const dir = mkdtempSync(join(tmpdir(), "peligros-pe-"));
  const gj = (fs: Feature<unknown>[]) => JSON.stringify({ type: "FeatureCollection", features: fs });
  const contenido = { zonas_criticas: gj(zonas), peligros: gj(peligros) };
  writeFileSync(join(dir, ARCHIVOS.zonas_criticas), contenido.zonas_criticas);
  writeFileSync(join(dir, ARCHIVOS.peligros), contenido.peligros);
  const conjunto = (c: keyof typeof contenido) => ({ sha256: sha256(contenido[c]), publicados: 0 });
  writeFileSync(
    join(dir, ARCHIVOS.metadata),
    JSON.stringify({
      version_esquema: 1,
      fecha_captura: new Date().toISOString(),
      fuente: { nombre: "prueba", url: "https://example.org", licencia: "-" },
      conjuntos: { zonas_criticas: conjunto("zonas_criticas"), peligros: conjunto("peligros") },
    }),
  );
  return dir;
}

let datos: string;
let vacio: string;
beforeAll(() => {
  const zonas = crudo.zonas_criticas.map(normalizarZona);
  const peligros = crudo.peligros
    .map((f) => normalizarPeligro(f, "Peligros Geológicos", crudo.dominios))
    .filter((p): p is Feature<Peligro> => !("excluido" in p));
  inferirUbigeos([...zonas, ...peligros].map((f) => f.properties));
  datos = escribirDatos(zonas, peligros);
  vacio = escribirDatos([], []);
});

test("unirNegativos: '--lat -12.05' no se confunde con una opción", () => {
  expect(unirNegativos(["cerca", "--lat", "-12.05", "--lon", "-77", "--json"])).toEqual([
    "cerca",
    "--lat=-12.05",
    "--lon=-77",
    "--json",
  ]);
});

describe("cerca", () => {
  // Comité 78 (Carabayllo), zona crítica real del fixture.
  const args = ["cerca", "--lat", "-11.8965", "--lon", "-77.014", "--radio", "500"];

  test("devuelve registros ordenados con procedencia y aviso", () => {
    const { code, json } = correr(...args, "--datos", datos);
    expect(code).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.zonas_criticas[0].paraje).toBe("Comité 78, Virgen de Fátima");
    expect(json.zonas_criticas[0].distancia_m).toBeLessThan(100);
    expect(json.datos.fuente).toBe("prueba");
    expect(json.aviso.join(" ")).toContain("NO significa que el lugar sea seguro");
  });

  test("muestra zonas sin coordenadas del mismo distrito", () => {
    const { json } = correr(...args, "--datos", datos);
    expect(json.sin_coordenadas_en_distritos_cercanos.map((z: any) => z.paraje)).toEqual(["Torre Blanca"]);
  });

  test("lat/lon invertidos → FUERA_DE_COBERTURA (no una lista vacía)", () => {
    const { code, json } = correr("cerca", "--lat", "-77.014", "--lon", "-11.8965", "--datos", datos);
    expect(code).toBe(2);
    expect(json.code).toBe("FUERA_DE_COBERTURA");
  });

  test("sin datos → DATOS_VACIOS (nunca '0 resultados')", () => {
    const { code, json } = correr(...args, "--datos", vacio);
    expect(code).toBe(1);
    expect(json.code).toBe("DATOS_VACIOS");
  });

  test("parámetros inválidos → ARGS_INVALIDOS", () => {
    expect(correr("cerca", "--lat", "", "--lon", "-77", "--datos", datos).json.code).toBe("ARGS_INVALIDOS");
    expect(
      correr("cerca", "--lat", "-12", "--lon", "-77", "--tipo", "lava", "--datos", datos).json.code,
    ).toBe("ARGS_INVALIDOS");
  });

  test("--params con JSON en línea y alias huaico", () => {
    const { json } = correr(
      "cerca",
      "--params",
      '{"lat":-11.8965,"lon":-77.014,"tipo":"huaico"}',
      "--datos",
      datos,
    );
    expect(json.consulta.tipo).toEqual(["flujo"]);
  });
});

describe("listar y zona", () => {
  test("listar por distrito incluye la zona sin coordenadas", () => {
    const { json } = correr("listar", "--ubigeo", "150106", "--datos", datos);
    expect(json.resultados.find((r: any) => r.paraje === "Torre Blanca")).toMatchObject({
      lat: null,
      lon: null,
    });
  });
  test("zona inexistente → NO_ENCONTRADO", () => {
    expect(correr("zona", "zc-00000000-0000-0000-0000-000000000000", "--datos", datos).json.code).toBe(
      "NO_ENCONTRADO",
    );
  });
});

describe("doctor", () => {
  test("datos íntegros", () => {
    const { code, json } = correr("doctor", "--sin-red", "--datos", datos);
    expect(json.checks.map((c: any) => [c.name, c.ok])).toEqual([
      ["datos", true],
      ["integridad", true],
      ["frescura", true],
    ]);
    expect(code).toBe(0);
  });
  test("detecta archivos alterados", () => {
    const dir = escribirDatos([], []);
    writeFileSync(join(dir, ARCHIVOS.peligros), '{"type":"FeatureCollection","features":[]} ');
    const { code, json } = correr("doctor", "--sin-red", "--datos", dir);
    expect(json.checks.find((c: any) => c.name === "integridad").ok).toBe(false);
    expect(code).toBe(1);
  });
});

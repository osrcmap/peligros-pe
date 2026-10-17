import { describe, expect, test } from "bun:test";
import {
  categorizar,
  type Feature,
  featureDe,
  inferirUbigeos,
  normalizarPeligro,
  normalizarZona,
  Peligro,
  ZonaCritica,
} from "../src/normalizar.js";
import crudo from "./fixtures/crudo.json";

const zonas = crudo.zonas_criticas.map(normalizarZona);
const porParaje = (paraje: string) => zonas.find((z) => z.properties.paraje === paraje)!;
const peligros = [
  ...crudo.peligros.map((f) => normalizarPeligro(f, "Peligros Geológicos", crudo.dominios)),
  ...crudo.otros_peligros.map((f) => normalizarPeligro(f, "Otros Peligros Geológicos", crudo.dominios)),
];

describe("categorizar", () => {
  test("términos oficiales y alias", () => {
    expect(categorizar("Flujo de detritos")).toEqual(["flujo"]);
    expect(categorizar("Huayco")).toEqual(["flujo"]);
    expect(categorizar("Deslizamiento - Flujo")).toEqual(["flujo", "deslizamiento"]);
    expect(categorizar("Inundación fluvial y erosión fluvial")).toEqual(["inundacion", "erosion"]);
  });
  test("erratas reales de la fuente", () => {
    expect(categorizar("Fujo de detritos")).toEqual(["flujo"]);
    expect(categorizar("Inundacón fluvial")).toEqual(["inundacion"]);
  });
  test("sin coincidencia → otro", () => {
    expect(categorizar("Licuefación de suelos")).toEqual(["otro"]);
    expect(categorizar(null)).toEqual(["otro"]);
  });
});

describe("normalizarZona", () => {
  test("registro completo", () => {
    const z = porParaje("Caverna Cambiopitec");
    expect(z.id).toBe("zc-e8b632a5-ae32-4939-aacf-0f3757c0a620");
    expect(z.geometry?.coordinates).toEqual([-78.384694, -5.629772]);
    expect(z.properties).toMatchObject({
      peligro: "Derrumbe",
      categorias: ["caida"],
      ubigeo: "010203",
      ubigeo_origen: "fuente",
      url_boletin: "https://hdl.handle.net/20.500.12544/244",
      recomendacion: null, // la fuente trae " "
      coordenadas_origen: "geometria",
    });
  });
  test("geometría vacía se recupera de X_GEO/Y_GEO", () => {
    const z = porParaje("Las Brisas");
    expect(z.geometry).not.toBeNull();
    expect(z.properties.coordenadas_origen).toBe("x_geo_y_geo");
  });
  test("sin coordenadas recuperables → geometry null; '--error--' no se publica como nombre", () => {
    const z = porParaje("Torre Blanca");
    expect(z.geometry).toBeNull();
    expect(z.properties.coordenadas_origen).toBeNull();
    expect(z.properties.departamento).toBe("Lima"); // de REGION, no "--error--"
    expect(z.properties.ubigeo).toBeNull();
  });
  test("todas validan contra el esquema publicado", () => {
    for (const z of zonas) expect(() => featureDe(ZonaCritica).parse(z)).not.toThrow();
  });
});

describe("inferirUbigeos", () => {
  test("completa por nombre cuando la coincidencia es única", () => {
    const copia = structuredClone(zonas);
    const n = inferirUbigeos(copia.map((z) => z.properties));
    const torre = copia.find((z) => z.properties.paraje === "Torre Blanca")!;
    expect(n).toBe(1);
    expect(torre.properties.ubigeo).toBe("150106");
    expect(torre.properties.ubigeo_origen).toBe("inferido_por_nombre");
  });
  test("no infiere si el nombre es ambiguo", () => {
    const lugar = { departamento: "X", provincia: "Y", distrito: "Z" };
    const rs = [
      { ...lugar, ubigeo: "111111", ubigeo_origen: "fuente" as const },
      { ...lugar, ubigeo: "222222", ubigeo_origen: "fuente" as const },
      { ...lugar, ubigeo: null, ubigeo_origen: null },
    ];
    expect(inferirUbigeos(rs)).toBe(0);
    expect(rs[2].ubigeo).toBeNull();
  });
});

describe("normalizarPeligro", () => {
  const publicados = peligros.filter((p): p is Feature<Peligro> => !("excluido" in p));

  test("respeta la marca NoMostrarWEB de la fuente", () => {
    expect(peligros.filter((p) => "excluido" in p)).toEqual([{ excluido: "NoMostrarWEB" }]);
  });
  test("decodifica dominios y fecha", () => {
    const flujo = publicados.find((p) => p.properties.codigo_peligro === "1000|1500|1504")!;
    expect(flujo.properties).toMatchObject({
      grupo: "Movimientos en Masa",
      tipo: "Flujos",
      subtipo: "Flujo de detritos",
      categorias: ["flujo"],
    });
    expect(flujo.properties.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test("subtipo fuera del dominio → null, la categoría sale del tipo", () => {
    const p = publicados.find((x) => x.properties.codigo_peligro === "1000|1300|1302")!;
    expect(p.properties.subtipo).toBeNull();
    expect(p.properties.tipo).toBe("Deslizamiento");
    expect(p.properties.categorias).toEqual(["deslizamiento"]);
  });
  test("registros en revisión se publican marcados", () => {
    expect(publicados.filter((p) => p.properties.en_revision)).toHaveLength(1);
  });
  test("todos validan contra el esquema publicado", () => {
    for (const p of publicados) expect(() => featureDe(Peligro).parse(p)).not.toThrow();
  });
});

import { expect, test } from "bun:test";
import { cerca, listar } from "../src/consultas.js";
import type { Categoria, Feature } from "../src/normalizar.js";

type P = { id: string; categorias: Categoria[]; ubigeo: string | null };
const LAT = -11.9437;
const LON = -76.7036;
const f = (
  id: string,
  dLat: number | null,
  categorias: Categoria[] = ["flujo"],
  ubigeo = "150118",
): Feature<P> => ({
  type: "Feature",
  id,
  geometry: dLat === null ? null : { type: "Point", coordinates: [LON, LAT + dLat] },
  properties: { id, categorias, ubigeo },
});

const fs = [
  f("lejos", 0.05),
  f("b", 0.002, ["inundacion"]),
  f("a", 0.001),
  f("sin-coord", null, ["flujo"], "150119"),
];

test("cerca: filtra por radio, ordena y mide en metros", () => {
  const rs = cerca(fs, LAT, LON, 1000);
  expect(rs.map((r) => r.id)).toEqual(["a", "b"]);
  expect(rs[0].distancia_m).toBe(111); // 0.001° de latitud ≈ 111 m
  expect(rs[0]).toMatchObject({ lat: LAT + 0.001, lon: LON });
});

test("cerca: el límite del radio es inclusivo y los sin coordenadas se ignoran", () => {
  expect(cerca(fs, LAT, LON, 111.2).map((r) => r.id)).toEqual(["a"]);
  expect(cerca(fs, LAT, LON, 50_000).map((r) => r.id)).toEqual(["a", "b", "lejos"]);
});

test("cerca: filtro por categoría", () => {
  expect(cerca(fs, LAT, LON, 1000, ["inundacion"]).map((r) => r.id)).toEqual(["b"]);
});

test("listar: por prefijo de ubigeo, incluye registros sin coordenadas", () => {
  expect(listar(fs, "150119")).toEqual([
    { id: "sin-coord", categorias: ["flujo"], ubigeo: "150119", lat: null, lon: null },
  ]);
  expect(listar(fs, "1501")).toHaveLength(4);
  expect(listar(fs, "02")).toHaveLength(0);
});

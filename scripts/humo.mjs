// Prueba de humo del paquete compilado (dist/cli.js) con el Node que la ejecute.
// Sin dependencias: corre en cualquier Node >= 20. Uso: node scripts/humo.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cli = new URL("../dist/cli.js", import.meta.url).pathname;

function correr(...args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--json"], { encoding: "utf8" });
  assert.ok(r.stdout.trim(), `sin salida para: ${args.join(" ")}\nstderr: ${r.stderr}`);
  return { code: r.status, json: JSON.parse(r.stdout) };
}

const version = correr("--version");
assert.equal(version.json.version, pkg.version);

const cerca = correr("cerca", "--lat", "-11.9437", "--lon", "-76.7036", "--radio", "1000");
assert.equal(cerca.code, 0);
assert.equal(cerca.json.ok, true);
assert.ok(cerca.json.resumen.peligros > 0, "Chosica debería tener peligros inventariados a 1 km");
assert.ok(cerca.json.aviso.length > 0);

const invertido = correr("cerca", "--lat", "-76.7036", "--lon", "-11.9437");
assert.equal(invertido.code, 2);
assert.equal(invertido.json.code, "FUERA_DE_COBERTURA");

const doctor = correr("doctor", "--sin-red");
assert.equal(doctor.json.checks.find((c) => c.name === "integridad").ok, true);
assert.equal(doctor.json.checks.find((c) => c.name === "datos").ok, true);

console.log(`humo ok: node ${process.version}, ${pkg.name}@${pkg.version}`);

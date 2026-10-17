// Prueba de humo del paquete compilado (dist/cli.js) con el Node que la ejecute.
// Sin dependencias: corre en cualquier Node >= 20. Uso: node scripts/humo.mjs
//
// Corre sobre una copia aislada (solo lo que se publica, sin node_modules): si el bundle
// dejara de ser autónomo, falla aquí y no en la máquina de quien lo instala.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const aislado = mkdtempSync(join(tmpdir(), "peligros-pe-humo-"));
for (const f of ["dist", "data", "package.json"]) cpSync(join(raiz, f), join(aislado, f), { recursive: true });
const cli = join(aislado, "dist/cli.js");

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

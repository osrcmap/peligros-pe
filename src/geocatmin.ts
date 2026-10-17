// Cliente mínimo del servicio ArcGIS REST de INGEMMET (GEOCATMIN).
import https from "node:https";
import { rootCertificates } from "node:tls";
import pkg from "../package.json" with { type: "json" };

export const SERVICIO =
  "https://geocatmin.ingemmet.gob.pe/arcgis/rest/services/SERV_PELIGROS_GEOLOGICOS/MapServer";

/** Capas del servicio que usamos (id numérico en el MapServer). */
export const CAPAS = {
  peligros: 0, // "Peligros Geológicos" (movimientos en masa)
  otros_peligros: 1, // "Otros Peligros Geológicos" (erosión, inundación, hundimiento...)
  zonas_criticas: 2, // "Zonas Críticas"
} as const;

// geocatmin.ingemmet.gob.pe no envía el certificado intermedio, así que la
// verificación TLS falla sin él. Lo añadimos (no desactivamos la verificación).
// Sectigo Public Server Authentication CA OV R36, emitido por Sectigo Root R46.
// Fuente: http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt
// SHA-256: 65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30
// Vence: 2036-03-21.
const SECTIGO_OV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----`;

const CA = [...rootCertificates, SECTIGO_OV_R36];
const USER_AGENT = `peligros-pe/${pkg.version}`;

/** GET (o POST si hay `form`) que devuelve JSON. Lanza en HTTP != 200 y en errores ArcGIS (que llegan con 200). */
export function pedirJson(url: string, form?: Record<string, string>, timeoutMs = 60_000): Promise<any> {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: body ? "POST" : "GET",
        ca: CA,
        timeout: timeoutMs,
        headers: {
          "user-agent": USER_AGENT,
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
          let json: any;
          try {
            json = JSON.parse(texto);
          } catch {
            return reject(new Error(`Respuesta no JSON de ${url}`));
          }
          if (json?.error)
            return reject(new Error(`ArcGIS ${json.error.code}: ${json.error.message} (${url})`));
          resolve(json);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Tiempo agotado (${timeoutMs} ms) en ${url}`)));
    req.on("error", reject);
    req.end(body);
  });
}

async function conReintentos<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

export async function contar(capa: number): Promise<number> {
  const r = await pedirJson(
    `${SERVICIO}/${capa}/query?where=1%3D1&returnCountOnly=true&f=json`,
    undefined,
    20_000,
  );
  return r.count;
}

/** campo -> código -> nombre, a partir de los dominios "codedValue" de la capa. */
export type Dominios = Record<string, Record<string, string>>;

export async function dominios(capa: number): Promise<Dominios> {
  const info = await conReintentos(() => pedirJson(`${SERVICIO}/${capa}?f=json`));
  const out: Dominios = {};
  for (const f of info.fields ?? []) {
    if (f.domain?.type !== "codedValue") continue;
    out[f.name] = Object.fromEntries(
      f.domain.codedValues.map((c: { code: unknown; name: string }) => [String(c.code), c.name]),
    );
  }
  return out;
}

/**
 * Descarga todas las entidades de una capa como GeoJSON (WGS84).
 * El servicio no permite paginar y limita a 2000 por consulta: pedimos los
 * OBJECTID y luego bajamos por lotes. Verifica que llegue exactamente lo pedido.
 */
export async function descargarCapa(capa: number, lote = 500): Promise<any[]> {
  const r = await conReintentos(() =>
    pedirJson(`${SERVICIO}/${capa}/query?where=1%3D1&returnIdsOnly=true&f=json`),
  );
  const ids: number[] = [...(r.objectIds ?? [])].sort((a, b) => a - b);
  const features: any[] = [];
  for (let i = 0; i < ids.length; i += lote) {
    const parte = ids.slice(i, i + lote);
    const fc = await conReintentos(() =>
      pedirJson(`${SERVICIO}/${capa}/query`, {
        objectIds: parte.join(","),
        outFields: "*",
        returnGeometry: "true",
        outSR: "4326",
        f: "geojson",
      }),
    );
    features.push(...fc.features);
  }
  const recibidos = new Set(features.map((f) => f.properties?.OBJECTID));
  if (features.length !== ids.length || ids.some((id) => !recibidos.has(id))) {
    throw new Error(
      `Capa ${capa}: se pidieron ${ids.length} entidades y llegaron ${features.length} distintas.`,
    );
  }
  return features;
}

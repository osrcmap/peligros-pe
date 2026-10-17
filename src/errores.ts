import { AppError, type ErrorMap } from "./foundation/error-map.js";

export const ERRORES = {
  ARGS_INVALIDOS: {
    name: "ArgsInvalidos",
    human: "Parámetros inválidos.",
    hint: "Revisa los parámetros con `peligros-pe schema <comando>`.",
  },
  COMANDO_DESCONOCIDO: {
    name: "ComandoDesconocido",
    human: "Comando desconocido.",
    hint: "Comandos: cerca, listar, zona, schema, doctor. Usa `peligros-pe --help`.",
  },
  PARAMS_INVALIDOS: {
    name: "ParamsInvalidos",
    human: "No se pudo leer --params.",
    hint: "--params acepta un objeto JSON en línea o @ruta/al/archivo.json.",
  },
  FUERA_DE_COBERTURA: {
    name: "FueraDeCobertura",
    human: "El punto está fuera del Perú.",
    hint: "Verifica el orden: --lat es la latitud (Perú: -18.5 a 0.1) y --lon la longitud (Perú: -81.5 a -68.5).",
  },
  NO_ENCONTRADO: {
    name: "NoEncontrado",
    human: "No existe un registro con ese id.",
    hint: "Los ids vienen de `cerca` o `listar` (empiezan con zc- o pg-).",
  },
  DATOS_NO_ENCONTRADOS: {
    name: "DatosNoEncontrados",
    human: "No se encontraron los archivos de datos.",
    hint: "Reinstala el paquete o pasa --datos <directorio>. Diagnóstico: `peligros-pe doctor`.",
  },
  DATOS_INVALIDOS: {
    name: "DatosInvalidos",
    human: "Los archivos de datos están dañados o no tienen el formato esperado.",
    hint: "Reinstala el paquete o regenera con `bun run actualizar`. Diagnóstico: `peligros-pe doctor`.",
  },
  DATOS_VACIOS: {
    name: "DatosVacios",
    human: "No hay registros cargados.",
    hint: "Esto NO significa que no haya peligro en la zona. Regenera los datos con `bun run actualizar`.",
  },
  ERROR_INTERNO: {
    name: "ErrorInterno",
    human: "Error inesperado.",
    hint: "Abre un issue con el comando exacto que corriste.",
  },
} satisfies ErrorMap;

export type Codigo = keyof typeof ERRORES;

/** Errores de uso salen con código 2; el resto con 1. */
export const exitCode = (code: string) =>
  ["ARGS_INVALIDOS", "COMANDO_DESCONOCIDO", "PARAMS_INVALIDOS", "FUERA_DE_COBERTURA"].includes(code) ? 2 : 1;

export const fallo = (code: Codigo, detalle?: string, causa?: unknown) =>
  new AppError(code, detalle ? { ...ERRORES[code], human: detalle } : ERRORES[code], causa);

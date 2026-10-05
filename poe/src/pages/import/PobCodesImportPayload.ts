import {defaultSettings, SavedSettings} from "@poe/utils/SavedSettings";
import {getImportProfileNameError} from "@poe/utils/LocalStorage";
import type {MapModsRegex, Token, MapOption} from "@poe/types/generated/mapmods";

export const IMPORT_URL_BYTES = 8 * 1024;
export const IMPORT_JSON_BYTES = 4 * 1024;
export interface PobCodesImportPayload {
  schema: "map-exclusions";
  version: 1;
  game: "poe";
  idNamespace: "poe.re-map-token";
  name: string;
  excludeIds: number[];
}
export class PobCodesImportError extends Error {}
export type ImportRequest = {ok: true; payload: PobCodesImportPayload} | {ok: false; error: string};

/** Version 1 intentionally accepts only this source and exact field set. */
export function parsePobCodesImportPayload(href: string): ImportRequest {
  try {
    if (new TextEncoder().encode(href).length > IMPORT_URL_BYTES) throw new PobCodesImportError("This import link is too large (maximum 8 KiB).");
    const url = new URL(href);
    const query = url.searchParams;
    if (query.getAll("app").length !== 1 || query.getAll("data").length !== 1 || [...query.keys()].some(key => key !== "app" && key !== "data")) {
      throw new PobCodesImportError("The import link must contain exactly one app and one data parameter.");
    }
    if (query.get("app") !== "pob.codes") throw new PobCodesImportError("This import source is not supported. Expected PoB Codes.");
    const encoded = query.get("data")!;
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) throw new PobCodesImportError("The import data is not valid base64url.");
    let binary: string;
    try { binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/")); }
    catch { throw new PobCodesImportError("The import data is not valid base64url."); }
    if (btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== encoded) throw new PobCodesImportError("The import data is not valid base64url.");
    if (binary.length > IMPORT_JSON_BYTES) throw new PobCodesImportError("The decoded import data is too large (maximum 4 KiB).");
    let value: unknown;
    try {
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch { throw new PobCodesImportError("The import data must be valid UTF-8 JSON."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new PobCodesImportError("The import data must be a map-exclusions object.");
    const payload = value as Record<string, unknown>;
    const keys = ["schema", "version", "game", "idNamespace", "name", "excludeIds"];
    if (Object.keys(payload).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(payload, key))) throw new PobCodesImportError("The import fields are unsupported. Ask PoB Codes for a current version-1 link.");
    if (payload.schema !== "map-exclusions" || payload.version !== 1 || payload.game !== "poe" || payload.idNamespace !== "poe.re-map-token") throw new PobCodesImportError("This import format, version, game, or ID namespace is not supported.");
    if (typeof payload.name !== "string") throw new PobCodesImportError("The profile name must be text.");
    const name = payload.name.trim();
    const nameError = getImportProfileNameError(name);
    if (nameError) throw new PobCodesImportError(nameError);
    const ids = payload.excludeIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 256 || ids.some(id => typeof id !== "number" || !Number.isInteger(id) || id < -2147483648 || id > 2147483647) || new Set(ids).size !== ids.length) {
      throw new PobCodesImportError("Select 1-256 unique signed 32-bit map modifier IDs.");
    }
    return {ok: true, payload: {...payload, name, excludeIds: [...ids]} as PobCodesImportPayload};
  } catch (error) {
    return {ok: false, error: error instanceof PobCodesImportError ? error.message : "The import link is malformed."};
  }
}

export interface ImportPreview {
  profile: SavedSettings;
  recognized: Token<MapOption>[];
  unknownIds: number[];
}
export function preparePobCodesImport(payload: PobCodesImportPayload, catalog: MapModsRegex): ImportPreview {
  const byId = new Map(catalog.tokens.map(token => [token.id, token]));
  const recognized = payload.excludeIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const unknownIds = payload.excludeIds.filter(id => !byId.has(id));
  if (!recognized.length) throw new PobCodesImportError("None of these modifiers are recognized. This link may be stale; generate a new selection in PoB Codes.");
  return {
    profile: {...defaultSettings, name: payload.name, language: "ENGLISH", map: {...defaultSettings.map, badIds: recognized.map(token => token.id)}},
    recognized,
    unknownIds,
  };
}

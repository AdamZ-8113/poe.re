import {describe, expect, it} from "vitest";
import catalogJson from "../../../generated/mapmods/Generated.Map.ENGLISH.json";
import fixtures from "./PobCodesImportFixtures.json";
import {parsePobCodesImportPayload, PobCodesImportPayload, preparePobCodesImport} from "./PobCodesImportPayload";
import {defaultSettings} from "@poe/utils/SavedSettings";
import type {MapModsRegex} from "@poe/types/generated/mapmods";
import {generateMapModRegex} from "@poe/pages/maps/OptimizedMapOutput";

const catalog = catalogJson as MapModsRegex;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const url = (value: unknown) => `https://poe.re/import?app=pob.codes&data=${encode(value)}`;
const valid = fixtures.valid as PobCodesImportPayload;

describe("PoB Codes version-1 payload", () => {
  it("decodes the shared signed-ID fixture and trims the name", () => {
    expect(parsePobCodesImportPayload(url({...valid, name: "  Maps \u2713  "}))).toEqual({ok: true, payload: {...valid, name: "Maps \u2713"}});
  });
  it("accepts every current English catalog ID within both byte limits", () => {
    const payload = {...valid, excludeIds: catalog.tokens.map(token => token.id)};
    expect(payload.excludeIds).toHaveLength(118);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(4096);
    expect(Buffer.byteLength(url(payload))).toBeLessThan(8192);
    expect(parsePobCodesImportPayload(url(payload))).toEqual({ok: true, payload});
  });
  it.each([
    "", "?app=pob.codes", "?data=AA", "?app=other&data=AA",
    "?app=pob.codes&app=pob.codes&data=AA", "?app=pob.codes&data=AA&data=AA",
    "?app=pob.codes&data=AA&extra=1", "?app=pob.codes&data=",
    "?app=pob.codes&data=+_", "?app=pob.codes&data=AA=", "?app=pob.codes&data=A", "?app=pob.codes&data=AB",
  ])("rejects malformed, duplicate, or unsupported query %s", query => {
    expect(parsePobCodesImportPayload(`https://poe.re/import${query}`).ok).toBe(false);
  });
  it.each([null, [], "text", 1, {}, fixtures.extraKey, fixtures.unsafeName, fixtures.oversizedName,
    {...valid, schema: "other"}, {...valid, version: 2}, {...valid, version: "1"}, {...valid, game: "poe2"}, {...valid, idNamespace: "ggg"},
    {...valid, name: 5}, {...valid, name: " "}, {...valid, name: "bad\u0000name"}, {...valid, name: "bad\u202ename"},
    {...valid, name: "CONSTRUCTOR"}, {...valid, name: "prototype"}, {...valid, excludeIds: []}, {...valid, excludeIds: null},
    {...valid, excludeIds: "1"}, {...valid, excludeIds: [1, 1]}, {...valid, excludeIds: [1.5]}, {...valid, excludeIds: ["1"]},
    {...valid, excludeIds: [null]}, {...valid, excludeIds: [true]}, {...valid, excludeIds: [-2147483649]}, {...valid, excludeIds: [2147483648]},
    {...valid, excludeIds: Array.from({length: 257}, (_, i) => i)},
  ])("rejects an invalid payload %#", value => { expect(parsePobCodesImportPayload(url(value)).ok).toBe(false); });
  it("accepts the exact name/count/int32 bounds", () => {
    expect(parsePobCodesImportPayload(url({...valid, name: "x".repeat(80), excludeIds: [-2147483648, 2147483647]})).ok).toBe(true);
    expect(parsePobCodesImportPayload(url({...valid, excludeIds: Array.from({length: 256}, (_, i) => i)})).ok).toBe(true);
  });
  it("rejects a missing field, invalid JSON and invalid UTF-8", () => {
    const {name, ...missing} = valid;
    for (const encoded of [encode(missing), Buffer.from("{").toString("base64url"), Buffer.from([255]).toString("base64url")]) {
      expect(parsePobCodesImportPayload(`https://poe.re/import?app=pob.codes&data=${encoded}`).ok).toBe(false);
    }
  });
  it("accepts exactly 4 KiB of decoded JSON and rejects the next byte", () => {
    const json = JSON.stringify(valid);
    const padded = json + " ".repeat(4096 - Buffer.byteLength(json));
    const href = (value: string) => `https://poe.re/import?app=pob.codes&data=${Buffer.from(value).toString("base64url")}`;
    expect(parsePobCodesImportPayload(href(padded)).ok).toBe(true);
    expect(parsePobCodesImportPayload(href(padded + " "))).toMatchObject({ok: false, error: expect.stringContaining("4 KiB")});
  });
  it("bounds UTF-8 decoded bytes and full URL before parsing", () => {
    expect(parsePobCodesImportPayload(url({...valid, name: "\u2713".repeat(1500)}))).toMatchObject({ok: false, error: expect.stringContaining("4 KiB")});
    expect(parsePobCodesImportPayload(`https://poe.re/import?app=pob.codes&data=${"A".repeat(8192)}`).ok).toBe(false);
  });
});

describe("mapping to receiver defaults", () => {
  it("overlays exactly the name, English language and exclusions, leaving defaults intact", () => {
    const before = JSON.stringify(defaultSettings);
    const result = preparePobCodesImport(valid, catalog);
    expect(result.profile).toEqual({...defaultSettings, name: valid.name, language: "ENGLISH", map: {...defaultSettings.map, badIds: valid.excludeIds}});
    expect(result.profile).not.toBe(defaultSettings);
    expect(result.profile.map).not.toBe(defaultSettings.map);
    expect(result.profile.map.goodIds).toEqual([]);
    expect(result.profile.map.displayNightmareMods).toBe(true);
    expect(result.profile.map.tradeExcludeValdo).toBe(defaultSettings.map.tradeExcludeValdo);
    expect(result.profile.map.tradeExcludeShaperElder).toBe(defaultSettings.map.tradeExcludeShaperElder);
    // Independently neutralize regex-affecting filters: future non-neutral defaults must fail this proof.
    const neutral = {...result.profile.map, goodIds: [], quantity: "", packsize: "", itemRarity: "", currency: "", scarab: "", divination: "", mapDropChance: "", displayNightmareMods: true,
      rarity: {normal: true, magic: true, rare: true, include: true}, corrupted: {enabled: false, include: true}, unidentified: {enabled: false, include: false},
      asyncPriceRange: {...result.profile.map.asyncPriceRange, enabled: false}, quality: {regular: "", currency: "", divination: "", rarity: "", packSize: "", scarab: ""}};
    expect(generateMapModRegex(result.profile.map, catalog, "ENGLISH")).toBe(generateMapModRegex(neutral, catalog, "ENGLISH"));
    result.profile.map.badIds.push(1);
    expect(JSON.stringify(defaultSettings)).toBe(before);
  });
  it("partitions unknown IDs explicitly and preserves requested order", () => {
    const preview = preparePobCodesImport(fixtures.mixedUnknown as PobCodesImportPayload, catalog);
    expect(preview.recognized.map(token => token.id)).toEqual([246480838]);
    expect(preview.unknownIds).toEqual([123456789]);
    expect(preview.profile.map.badIds).toEqual([246480838]);
    expect(() => preparePobCodesImport(fixtures.allUnknown as PobCodesImportPayload, catalog)).toThrow(/None/);
  });
});

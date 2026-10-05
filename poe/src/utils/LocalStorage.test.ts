import {beforeEach, afterEach, describe, expect, it, vi} from "vitest";
import {createImportProfile, getImportProfileNameError, loadSettings, saveSettings, selectedProfile, suggestImportProfileName} from "./LocalStorage";
import {defaultSettings, SavedSettings} from "./SavedSettings";

const draft = (name = "PoB Codes map checks"): SavedSettings => ({...defaultSettings, name, map: {...defaultSettings.map, badIds: [246480838]}});
const seed = () => {
  localStorage.setItem("profiles", JSON.stringify({Existing: {...defaultSettings, name: "Existing", language: "FRENCH"}}));
  localStorage.setItem("selectedProfile", "Existing");
};
beforeEach(() => { localStorage.clear(); seed(); });
afterEach(() => vi.restoreAllMocks());

describe("receiver-only create/select", () => {
  it("persists exactly one own profile before selecting, preserves the old profile and defaults", () => {
    const old = JSON.stringify(loadSettings("Existing"));
    const defaults = JSON.stringify(defaultSettings);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    createImportProfile(draft());
    expect(writes.mock.calls.map(([key]) => key)).toEqual(["profiles", "selectedProfile"]);
    expect(selectedProfile()).toBe("PoB Codes map checks");
    expect(loadSettings(selectedProfile()).map.badIds).toEqual([246480838]);
    expect(JSON.stringify(loadSettings("Existing"))).toBe(old);
    expect(JSON.stringify(defaultSettings)).toBe(defaults);
    expect(() => createImportProfile(draft())).toThrow(/already exists/);
    expect(Object.keys(JSON.parse(localStorage.getItem("profiles")!))).toHaveLength(2);
  });
  it.each(["Existing", "existing", "EXISTING", "__proto__", "Prototype", "constructor", "", " ", "bad\u0000name", "x".repeat(81)])("rejects unsafe/colliding name %s without writes", name => {
    const before = localStorage.getItem("profiles");
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(() => createImportProfile(draft(name))).toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem("profiles")).toBe(before);
    expect(selectedProfile()).toBe("Existing");
  });
  it("proposes deterministic case-insensitive suffixes and keeps long names bounded", () => {
    expect(suggestImportProfileName("Existing")).toBe("Existing (2)");
    expect(suggestImportProfileName("Existing", ["existing", "Existing (2)"])).toBe("Existing (3)");
    expect(suggestImportProfileName("Fresh")).toBe("Fresh");
    const long = "x".repeat(80);
    expect(suggestImportProfileName(long, [long])).toHaveLength(80);
    expect(getImportProfileNameError(suggestImportProfileName(long, [long]))).toBeUndefined();
  });
  it("rechecks a name claimed since preview", () => {
    const name = suggestImportProfileName("Fresh");
    createImportProfile(draft(name));
    localStorage.setItem("selectedProfile", "Existing");
    const before = localStorage.getItem("profiles");
    expect(() => createImportProfile(draft(name))).toThrow(/already exists/);
    expect(localStorage.getItem("profiles")).toBe(before);
    expect(selectedProfile()).toBe("Existing");
  });
  it.each(["invalid", "null", "[]", "42"])("does not overwrite unreadable storage %s", raw => {
    localStorage.setItem("profiles", raw);
    expect(() => createImportProfile(draft())).toThrow();
    expect(localStorage.getItem("profiles")).toBe(raw);
    expect(selectedProfile()).toBe("Existing");
  });
  it.each(["profiles", "selectedProfile"])("restores the original state after a %s write failure", failKey => {
    const before = localStorage.getItem("profiles");
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
      if (key === failKey) throw new DOMException("blocked", "QuotaExceededError");
      original.call(this, key, value);
    });
    expect(() => createImportProfile(draft())).toThrow();
    expect(localStorage.getItem("profiles")).toBe(before);
    expect(selectedProfile()).toBe("Existing");
  });
  it("does not select when the profile write silently fails verification", () => {
    const before = localStorage.getItem("profiles");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(() => createImportProfile(draft())).toThrow(/verify/);
    expect(localStorage.getItem("profiles")).toBe(before);
    expect(selectedProfile()).toBe("Existing");
  });
  it("rolls back its profile when selection silently fails verification", () => {
    const before = localStorage.getItem("profiles");
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
      if (key !== "selectedProfile") original.call(this, key, value);
    });
    expect(() => createImportProfile(draft())).toThrow(/selection/);
    expect(localStorage.getItem("profiles")).toBe(before);
    expect(selectedProfile()).toBe("Existing");
  });
  it("leaves existing save/overwrite and case-sensitive behavior intact", () => {
    saveSettings(draft("Existing"));
    saveSettings(draft("existing"));
    expect(loadSettings("Existing").map.badIds).toEqual([246480838]);
    expect(Object.keys(JSON.parse(localStorage.getItem("profiles")!))).toEqual(["Existing", "existing"]);
  });
});

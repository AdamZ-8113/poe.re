import {defaultSettings, SavedSettings} from "./SavedSettings";
import {merge, safeLoad} from "@shared/core/utils";

interface SavedProfiles {
  [key: string]: SavedSettings
}

export const PROFILE_SETTINGS_CHANGED_EVENT = "poe:profile-settings-changed";

const notifyProfileSettingsChanged = (profile: string): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<string>(PROFILE_SETTINGS_CHANGED_EVENT, {detail: profile}));
  }
};

export const loadProfiles = (): SavedProfiles => {
  return safeLoad("profiles");
}

export const loadProfileNames = (): string[] => {
  return Object.keys(loadProfiles());
}

export const ensureDefaultProfile = (): void => {
  const profiles = loadProfiles();
  if (!profiles.default) {
    profiles.default = defaultSettings;
    localStorage.setItem("profiles", JSON.stringify(profiles));
  }
}

export const deleteProfile = (profile: string): void => {
  const profiles = loadProfiles();
  delete profiles[profile];
  localStorage.setItem("profiles", JSON.stringify(profiles));
}
export const loadSettings = (profile: string): SavedSettings => {
  const settings = loadProfiles()[profile] ?? {};
  const hydrated = merge(defaultSettings, settings);
  hydrated.version = Math.max(Number(hydrated.version) || 1, defaultSettings.version);
  hydrated.favorites = Array.isArray(hydrated.favorites) ? hydrated.favorites : [];
  return hydrated;
}

export const selectedProfile = (): string =>
  localStorage.getItem("selectedProfile") ?? "default";

export const setSelectedProfile = (name: string): void => {
  localStorage.setItem("selectedProfile", name);
}

export const saveSettings = (settings: SavedSettings): void => {
  localStorage.setItem("selectedProfile", settings.name);
  const profiles = loadProfiles();
  profiles[settings.name] = settings;
  localStorage.setItem("profiles", JSON.stringify(profiles));
  notifyProfileSettingsChanged(settings.name);
}

/** Atomically updates one profile from its latest persisted value. */
export const updateSettings = (profileName: string, updater: (settings: SavedSettings) => SavedSettings): SavedSettings => {
  const profiles = loadProfiles();
  const current = merge(defaultSettings, profiles[profileName] ?? {name: profileName});
  current.version = Math.max(Number(current.version) || 1, defaultSettings.version);
  const next = updater(current);
  profiles[profileName] = next;
  localStorage.setItem("profiles", JSON.stringify(profiles));
  notifyProfileSettingsChanged(profileName);
  return next;
};


export const valueFromKeyMap = (savedSettings: any, key: string): any | undefined => {
  const props = key.split(".");
  let obj = savedSettings;
  for (const prop of props) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, prop)) {
      return undefined;
    }
    obj = obj[prop];
  }
  return obj;
}

export const hasNKey = (savedSettings: any, key: string): boolean => {
  return valueFromKeyMap(savedSettings, key) === true;
}

export const hasNumberKey = (savedSettings: any, key: string): number | undefined => {
  const value = valueFromKeyMap(savedSettings, key);
  const isANumber = !isNaN(Number(value));
  return isANumber ? Number(value) : undefined;
}

/** These create-only/name rules belong solely to the dedicated import receiver. */
export const getImportProfileNameError = (name: string, names: string[] = []): string | undefined => {
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > 80 || /[\p{C}]/u.test(trimmed)) return "Use 1-80 printable characters for the profile name.";
  const key = trimmed.toLowerCase();
  if (["__proto__", "prototype", "constructor"].includes(key)) return "That profile name is reserved. Choose another name.";
  if (names.some(existing => existing.toLowerCase() === key)) return "A profile with that name already exists.";
  return undefined;
};

export const suggestImportProfileName = (base: string, names = loadProfileNames()): string => {
  const error = getImportProfileNameError(base);
  if (error) throw new Error(error);
  let candidate = base.trim();
  for (let suffix = 2; names.some(name => name.toLowerCase() === candidate.toLowerCase()); suffix++) {
    const ending = ` (${suffix})`;
    candidate = [...base.trim()].slice(0, 80 - ending.length).join("") + ending;
  }
  return candidate;
};

/** Verify create before selecting; never change the existing add/rename/overwrite flows. */
export const createImportProfile = (draft: SavedSettings): void => {
  const name = draft.name.trim();
  // Do not use safeLoad here: unreadable storage must never become an empty write.
  const before = localStorage.getItem("profiles");
  const profiles: SavedProfiles = JSON.parse(before ?? "{}");
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) throw new Error("Invalid profile storage");
  const error = getImportProfileNameError(name, Object.keys(profiles));
  if (error || Object.prototype.hasOwnProperty.call(profiles, name)) throw new Error(error ?? "Profile already exists");
  const previousSelection = localStorage.getItem("selectedProfile");
  const profile = {...draft, name};
  const expected = JSON.stringify({...profiles, [name]: profile});
  try {
    localStorage.setItem("profiles", expected);
    const actual = localStorage.getItem("profiles");
    const verified: SavedProfiles = JSON.parse(actual ?? "{}");
    if (!Object.prototype.hasOwnProperty.call(verified, name) || JSON.stringify(verified[name]) !== JSON.stringify(profile) || actual !== expected) throw new Error("Could not verify profile creation");
    setSelectedProfile(name);
    if (localStorage.getItem("selectedProfile") !== name) throw new Error("Could not verify profile selection");
  } catch (error) {
    // Restore only our own write, never overwrite a concurrent storage change.
    if (localStorage.getItem("profiles") === expected) {
      if (before === null) localStorage.removeItem("profiles");
      else localStorage.setItem("profiles", before);
    }
    if (localStorage.getItem("selectedProfile") === name) {
      if (previousSelection === null) localStorage.removeItem("selectedProfile");
      else localStorage.setItem("selectedProfile", previousSelection);
    }
    throw error;
  }
  notifyProfileSettingsChanged(name);
};

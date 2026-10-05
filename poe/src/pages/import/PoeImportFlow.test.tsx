import React, {StrictMode} from "react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {BrowserRouter} from "react-router-dom";
import {Poe1Routes} from "@poe/layout/Poe1Routes";
import {defaultSettings} from "@poe/utils/SavedSettings";
import fixtures from "./PobCodesImportFixtures.json";
import catalog from "../../../generated/mapmods/Generated.Map.ENGLISH.json";
import {replaceWithMaps} from "./ImportNavigation";

vi.mock("./ImportNavigation", () => ({replaceWithMaps: vi.fn()}));
const mount = (path: string) => {
  window.history.replaceState({idx: 0}, "", path);
  return render(<StrictMode><BrowserRouter><Poe1Routes/></BrowserRouter></StrictMode>);
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("profiles", JSON.stringify({default: {...defaultSettings}, Existing: {...defaultSettings, name: "Existing", language: "FRENCH", map: {...defaultSettings.map, badIds: [catalog.tokens[0].id], quantity: "50"}}}));
  localStorage.setItem("selectedProfile", "Existing");
  localStorage.setItem("webSettings", JSON.stringify({poe1League: "Standard"}));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/generated/mapmods/")) return {ok: true, json: async () => catalog};
    if (path.endsWith("leagues.txt")) return {ok: true, text: async () => "Standard\nHardcore"};
    throw new Error(`Unexpected fixture request ${path}`);
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("creates on confirmation, then fresh-mounts real maps/Profile under Strict Mode without changing the old profile", async () => {
  // Match the first-visit/import control with the same real layout providers.
  const control = mount("/import");
  await screen.findByRole("alert");
  await waitFor(() => expect(localStorage.getItem("webSettings")).toContain("Standard"));
  const old = JSON.stringify(JSON.parse(localStorage.getItem("profiles")!).Existing);
  const allProfiles = localStorage.getItem("profiles");
  control.unmount();
  const query = `/import?app=pob.codes&data=${Buffer.from(JSON.stringify(fixtures.valid)).toString("base64url")}`;
  const imported = mount(query);
  const confirm = await screen.findByRole("button", {name: "Create profile and open maps"});
  expect(localStorage.getItem("profiles")).toBe(allProfiles);
  expect(localStorage.getItem("selectedProfile")).toBe("Existing");
  expect(window.location.search).toBe("");
  vi.mocked(replaceWithMaps).mockImplementation(() => {
    expect(localStorage.getItem("selectedProfile")).toBe(fixtures.valid.name);
    expect(JSON.parse(localStorage.getItem("profiles")!)[fixtures.valid.name].map.badIds).toEqual(fixtures.valid.excludeIds);
  });
  fireEvent.click(confirm);
  expect(replaceWithMaps).toHaveBeenCalledOnce();
  imported.unmount();
  // jsdom cannot navigate documents: this is the explicit post-replace document.
  const maps = mount("/maps");
  await screen.findByRole("heading", {name: "Optimized Map Modifiers Regex"}, {timeout: 5000});
  await waitFor(() => expect(screen.getAllByText("Map Boss is accompanied by a Synthesis Boss")).toHaveLength(2));
  await waitFor(() => {
    const stored = JSON.parse(localStorage.getItem("profiles")!);
    expect(JSON.stringify(stored.Existing)).toBe(old);
    expect(stored[fixtures.valid.name].language).toBe("ENGLISH");
    expect(stored[fixtures.valid.name].map.badIds).toEqual(fixtures.valid.excludeIds);
    expect(localStorage.getItem("selectedProfile")).toBe(fixtures.valid.name);
  });
  expect(document.querySelectorAll(".selectable-token-list-selected")).toHaveLength(2);
  expect(screen.getAllByText("Map Boss is accompanied by a Synthesis Boss")[0].closest(".selectable-token-list-selectable")).toHaveClass("selectable-token-list-selected");
  expect(document.querySelector('select[name="language"]')).toHaveValue("ENGLISH");
  const calls = vi.mocked(fetch).mock.calls.map(([path]) => String(path));
  expect(calls).toContain("/generated/mapmods/Generated.Map.ENGLISH.min.json");
  expect(calls).not.toContain("/generated/mapmods/Generated.Map.FRENCH.min.json");
  const after = localStorage.getItem("profiles");
  maps.unmount();
  mount("/import");
  await screen.findByRole("alert");
  expect(localStorage.getItem("profiles")).toBe(after);
  expect(replaceWithMaps).toHaveBeenCalledOnce();
});

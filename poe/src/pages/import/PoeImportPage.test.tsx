import React, {StrictMode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {BrowserRouter, useLocation} from "react-router-dom";
import fixtures from "./PobCodesImportFixtures.json";
import catalog from "../../../generated/mapmods/Generated.Map.ENGLISH.json";
import {defaultSettings} from "@poe/utils/SavedSettings";
import {loadMapMods} from "@poe/utils/loadData";
import {generateMapModRegex} from "@poe/pages/maps/OptimizedMapOutput";
import {replaceWithMaps} from "./ImportNavigation";
import PoeImportPage from "./PoeImportPage";

vi.mock("@poe/utils/loadData", () => ({loadMapMods: vi.fn()}));
vi.mock("./ImportNavigation", () => ({replaceWithMaps: vi.fn()}));
vi.mock("@poe/pages/maps/OptimizedMapOutput", async importOriginal => ({...await importOriginal<typeof import("@poe/pages/maps/OptimizedMapOutput")>(), generateMapModRegex: vi.fn()}));
const query = (payload: unknown) => `/import?app=pob.codes&data=${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
const LocationProof = () => { const location = useLocation(); return <span data-testid="router-location">{location.pathname}{location.search}</span>; };
const mount = (payload: unknown = fixtures.valid, href = query(payload)) => {
  window.history.replaceState({idx: 0, key: "import-test"}, "", href);
  return render(<StrictMode><BrowserRouter><PoeImportPage/><LocationProof/></BrowserRouter></StrictMode>);
};
const snapshot = () => ({profiles: localStorage.getItem("profiles"), selected: localStorage.getItem("selectedProfile")});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("profiles", JSON.stringify({Existing: {...defaultSettings, name: "Existing", language: "FRENCH"}}));
  localStorage.setItem("selectedProfile", "Existing");
  vi.mocked(loadMapMods).mockResolvedValue(catalog);
  vi.mocked(generateMapModRegex).mockReturnValue('"!lier$|cco"');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("dedicated import confirmation", () => {
  it("captures once under Strict Mode and scrubs both router and address bar without storage mutation", async () => {
    const before = snapshot();
    const view = mount();
    expect(await screen.findByRole("button", {name: "Create profile and open maps"})).toBeEnabled();
    expect(window.location.pathname + window.location.search).toBe("/import");
    expect(screen.getByTestId("router-location")).toHaveTextContent(/^\/import$/);
    expect(window.history.state.idx).toBe(0);
    expect(snapshot()).toEqual(before);
    fireEvent.change(screen.getByLabelText("New profile name"), {target: {value: "New name"}});
    expect(snapshot()).toEqual(before);
    view.unmount();
    mount(undefined, "/import");
    expect(await screen.findByRole("alert")).toHaveTextContent(/exactly one/);
    expect(screen.queryByRole("button", {name: "Create profile and open maps"})).toBeNull();
    expect(snapshot()).toEqual(before);
  });
  it.each(["Cancel", "Escape"])("discards the draft on %s without writes", async action => {
    const before = snapshot(); mount();
    await screen.findByLabelText("New profile name");
    if (action === "Cancel") fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
    else fireEvent.keyDown(window, {key: "Escape"});
    expect(screen.getByRole("status")).toHaveTextContent(/cancelled/);
    expect(screen.queryByLabelText("New profile name")).toBeNull();
    expect(snapshot()).toEqual(before);
    expect(replaceWithMaps).not.toHaveBeenCalled();
  });
  it("does not restore a cancelled loading draft when the catalog finishes", async () => {
    let finish!: (value: typeof catalog) => void;
    vi.mocked(loadMapMods).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mount(); fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
    finish(catalog);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/cancelled/));
    expect(screen.queryByLabelText("New profile name")).toBeNull();
  });
  it.each([fixtures.allUnknown, fixtures.extraKey, fixtures.unsafeName, fixtures.oversizedName])("rejects invalid/stale payload %# without writes", async payload => {
    const before = snapshot(); mount(payload);
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("New profile name")).toBeNull();
    expect(snapshot()).toEqual(before);
    expect(replaceWithMaps).not.toHaveBeenCalled();
  });
  it.each(["catalog", "regex"])("fails visibly on %s preview failure and cannot import", async kind => {
    if (kind === "catalog") vi.mocked(loadMapMods).mockRejectedValue(new Error("offline"));
    else vi.mocked(generateMapModRegex).mockImplementation(() => { throw new Error("preview unavailable"); });
    const before = snapshot(); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(kind === "catalog" ? /catalog/ : /regex preview/);
    expect(screen.queryByRole("button", {name: /Create profile/})).toBeNull();
    expect(snapshot()).toEqual(before);
  });
  it("requires explicit partial confirmation and persists only displayed recognized IDs", async () => {
    const before = JSON.parse(localStorage.getItem("profiles")!).Existing;
    mount(fixtures.mixedUnknown);
    const confirm = await screen.findByRole("button", {name: "Import recognized modifiers only"});
    expect(screen.getByText("123456789")).toBeInTheDocument();
    vi.mocked(replaceWithMaps).mockImplementation(() => {
      expect(localStorage.getItem("selectedProfile")).toBe(fixtures.valid.name);
      const stored = JSON.parse(localStorage.getItem("profiles")!);
      expect(stored[fixtures.valid.name].map.badIds).toEqual([246480838]);
      expect(stored.Existing).toEqual(before);
    });
    fireEvent.click(confirm);
    expect(replaceWithMaps).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
  });
  it("proposes an editable suffix and disables unsafe/colliding edits", async () => {
    mount(fixtures.collision);
    const field = await screen.findByLabelText("New profile name");
    expect(field).toHaveValue("Existing (2)");
    const confirm = screen.getByRole("button", {name: "Create profile and open maps"});
    for (const value of ["existing", "__proto__", "", "x".repeat(81)]) {
      fireEvent.change(field, {target: {value}});
      expect(confirm).toBeDisabled();
      expect(field).toHaveAttribute("aria-invalid", "true");
    }
    fireEvent.change(field, {target: {value: "Fresh"}});
    expect(confirm).toBeEnabled();
  });
  it("rejects a stale cross-tab collision without selecting or overwriting it", async () => {
    mount(); const confirm = await screen.findByRole("button", {name: "Create profile and open maps"});
    const profiles = JSON.parse(localStorage.getItem("profiles")!);
    profiles[fixtures.valid.name] = {...defaultSettings, name: fixtures.valid.name, map: {...defaultSettings.map, badIds: [999]}};
    localStorage.setItem("profiles", JSON.stringify(profiles));
    const before = snapshot();
    fireEvent.click(confirm);
    expect(screen.getAllByRole("alert").some(alert => /already exists/.test(alert.textContent ?? ""))).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(replaceWithMaps).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New profile name"), {target: {value: `${fixtures.valid.name} (2)`}});
    expect(confirm).toBeEnabled();
  });
  it("reenables confirmation after a storage failure", async () => {
    mount(); const confirm = await screen.findByRole("button", {name: "Create profile and open maps"});
    const before = snapshot();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    fireEvent.click(confirm);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/);
    expect(confirm).toBeEnabled();
    expect(snapshot()).toEqual(before);
    expect(replaceWithMaps).not.toHaveBeenCalled();
  });
  it("submits by keyboard once and guards a rapid second submission", async () => {
    mount(); await screen.findByLabelText("New profile name");
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("New profile name"));
    await user.keyboard("{Enter}");
    fireEvent.submit(screen.getByRole("button", {name: "Opening maps..."}).closest("form")!);
    expect(replaceWithMaps).toHaveBeenCalledOnce();
    expect(Object.keys(JSON.parse(localStorage.getItem("profiles")!))).toEqual(["Existing", fixtures.valid.name]);
  });
});

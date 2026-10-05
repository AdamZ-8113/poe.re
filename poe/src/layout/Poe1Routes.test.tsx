import React from "react";
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import {MemoryRouter, useLocation} from "react-router-dom";
import {Poe1Routes} from "./Poe1Routes";

vi.mock("./Poe1Layout", async () => { const {Outlet} = await import("react-router-dom"); return {Poe1Layout: () => <Outlet/>}; });
vi.mock("../pages/vendor/Vendor", () => ({default: () => <h1>Vendor control</h1>}));
vi.mock("../pages/maps/OptimizedMapMods", () => ({default: () => <h1>Maps control</h1>}));
const Location = () => { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; };
afterEach(() => cleanup());
it("registers a separate import page without redirecting invalid links to maps", async () => {
  render(<MemoryRouter initialEntries={["/import"]}><Poe1Routes/><Location/></MemoryRouter>);
  expect(await screen.findByRole("heading", {name: "Import from PoB Codes"})).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/import");
  expect(screen.queryByRole("heading", {name: "Maps control"})).toBeNull();
});
it("retains the unknown-route redirect", async () => {
  render(<MemoryRouter initialEntries={["/not-a-route"]}><Poe1Routes/><Location/></MemoryRouter>);
  expect(await screen.findByRole("heading", {name: "Vendor control"})).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/vendor");
});

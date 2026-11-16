import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Simulate running outside the Tauri shell: no backend is reachable.
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(() => Promise.reject(new Error("invoke must not be called without a backend"))),
}));

import { App } from "./App";
import { ROUTES } from "./navigation/routes";

describe("App navigation", () => {
  it("renders every section in the sidebar and starts on Overview", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const route of ROUTES) {
      expect(nav).toHaveTextContent(route.label);
    }
    expect(screen.getByRole("button", { name: /Overview/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Overview");
  });

  it("switches section on click", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^Network/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Network");
    expect(screen.getByRole("button", { name: /^Network/ })).toHaveAttribute("aria-current", "page");
  });

  it("starts each section scrolled to the top", async () => {
    const user = userEvent.setup();
    render(<App />);
    const main = document.getElementById("main-content")!;
    main.scrollTop = 500;
    await user.click(screen.getByRole("button", { name: /^Network/ }));
    expect(main.scrollTop).toBe(0);
  });

  it("supports Ctrl+digit shortcuts", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "5", ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Processes");
    fireEvent.keyDown(window, { key: "9", ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  it("never shows fabricated metrics on unimplemented sections", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^History/ }));
    expect(screen.getByText("Not implemented")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+(\.\d+)?\s?%/)).not.toBeInTheDocument();
  });

  it("shows no measurements on the Overview when the backend is missing", async () => {
    render(<App />);
    expect(await screen.findByText("Backend unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /utilisation/ })).not.toBeInTheDocument();
  });

  it("reports a missing backend on the Settings page instead of inventing app info", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(await screen.findByText("Backend unavailable")).toBeInTheDocument();
  });

  it("switches theme from the Settings page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /^Settings/ }));
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

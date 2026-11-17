import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AvailabilityBadge, availabilityDetail } from "./Availability";
import { clampPercent, Meter } from "./Meter";
import { SegmentedControl } from "./SegmentedControl";
import { ErrorState } from "./States";
import { formatClock, formatDateTime } from "./TimeSeriesChart";
import { toneForUtilisation } from "./tone";

describe("Meter", () => {
  it("clamps values and exposes them to assistive tech", () => {
    render(<Meter value={140} label="CPU" />);
    expect(screen.getByRole("meter", { name: "CPU" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("clampPercent handles NaN and negatives", () => {
    expect(clampPercent(NaN)).toBe(0);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(42)).toBe(42);
  });

  it("escalates tone with utilisation", () => {
    expect(toneForUtilisation(10)).toBe("primary");
    expect(toneForUtilisation(80)).toBe("warning");
    expect(toneForUtilisation(95)).toBe("danger");
    expect(toneForUtilisation(NaN)).toBe("neutral");
  });
});

describe("AvailabilityBadge", () => {
  it("labels each state and explains unsupported metrics", () => {
    render(<AvailabilityBadge availability={{ state: "unsupported", reason: "No NVML driver" }} />);
    const badge = screen.getByText("Unsupported");
    expect(badge.closest("span[title]")).toHaveAttribute("title", "No NVML driver");
  });

  it("describes stale and not-implemented data", () => {
    expect(availabilityDetail({ state: "stale", ageSeconds: 4.6 })).toBe("Last update 5 s ago");
    expect(availabilityDetail({ state: "notImplemented", milestone: 4 })).toBe("Planned for milestone 4");
    expect(availabilityDetail({ state: "live" })).toBeUndefined();
  });
});

describe("SegmentedControl", () => {
  function Harness() {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return (
      <SegmentedControl
        label="Letters"
        value={v}
        onChange={setV}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ]}
      />
    );
  }

  it("selects on click and supports arrow keys with wrap-around", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: "B" }));
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "C" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "C" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("ErrorState", () => {
  it("shows the real message and a retry action", async () => {
    let retried = 0;
    render(<ErrorState message="access denied (os error 5)" onRetry={() => retried++} />);
    expect(screen.getByRole("alert")).toHaveTextContent("access denied (os error 5)");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(retried).toBe(1);
  });
});

describe("chart time formatters", () => {
  it("format valid timestamps and return a dash for invalid ones instead of throwing", () => {
    const t = new Date(2026, 0, 2, 13, 4, 5).getTime();
    expect(formatClock(t)).toMatch(/04.*05/);
    expect(formatDateTime(t)).toMatch(/04/);
    expect(formatClock(Number.NaN)).toBe("—");
    expect(formatDateTime(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

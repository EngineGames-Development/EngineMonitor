import { describe, expect, it } from "vitest";
import { makeEvent, makeSnapshot, makeSystemInfo, makeVolume } from "../test/fixtures";
import { readingAvailability, streamAvailability } from "./availability";
import { appendEvent, sumKnown, toHistoryPoint } from "./history";
import { initialMetricsState, metricsReducer } from "./store";

describe("history", () => {
  it("sums only known values", () => {
    expect(sumKnown([1, null, 2])).toBe(3);
    expect(sumKnown([null, null])).toBeNull();
    expect(sumKnown([])).toBeNull();
  });

  it("aggregates disk I/O only from volumes that report it", () => {
    const p = toHistoryPoint(
      makeSnapshot({
        storage: [
          makeVolume({ id: "a" }),
          makeVolume({ id: "b", io: { status: "unsupported", reason: "no counters" } }),
          makeVolume({
            id: "c",
            io: { status: "ok", value: { readBytesPerSec: null, writeBytesPerSec: 100, totalReadBytes: 1, totalWrittenBytes: 1 } },
          }),
        ],
      }),
    );
    expect(p.diskRead).toBe(1024);
    expect(p.diskWrite).toBe(2148);
  });

  it("keeps unprimed values as null, not zero", () => {
    const p = toHistoryPoint(
      makeSnapshot({
        cpu: { ...makeSnapshot().cpu, usagePercent: null },
        network: { receiveBytesPerSec: null, transmitBytesPerSec: null, interfaces: [] },
        storage: [],
      }),
    );
    expect(p.cpu).toBeNull();
    expect(p.rx).toBeNull();
    expect(p.diskRead).toBeNull();
  });

  it("caps history at capacity, dropping the oldest points", () => {
    let h = appendEvent([], null, makeEvent(0), 3);
    let prev = makeEvent(0);
    for (let i = 1; i <= 4; i++) {
      const e = makeEvent(i);
      h = appendEvent(h, prev, e, 3);
      prev = e;
    }
    expect(h).toHaveLength(3);
    expect(h.map((p) => p.t)).toEqual([2, 3, 4].map((i) => makeEvent(i).snapshot.timestampMs));
  });

  it("inserts a gap point when events were missed", () => {
    const e1 = makeEvent(1);
    const e5 = makeEvent(5);
    const h = appendEvent(appendEvent([], null, e1), e1, e5);
    expect(h).toHaveLength(3);
    expect(h[1]!.cpu).toBeNull();
    expect(h[1]!.t).toBeGreaterThan(h[0]!.t);
    expect(h[1]!.t).toBeLessThan(h[2]!.t);
  });

  it("ignores events that are not newer than the last point", () => {
    const e2 = makeEvent(2);
    const h = appendEvent([], null, e2);
    expect(appendEvent(h, e2, makeEvent(1))).toBe(h);
  });
});

describe("metricsReducer", () => {
  it("goes connecting -> live on the first event", () => {
    const s = metricsReducer(initialMetricsState(), { type: "event", event: makeEvent(0), now: 0 });
    expect(s.status).toBe("live");
    expect(s.history).toHaveLength(1);
  });

  it("drops duplicate or older sequences (hydrate racing the first event)", () => {
    let s = metricsReducer(initialMetricsState(), { type: "event", event: makeEvent(3), now: 0 });
    s = metricsReducer(s, { type: "event", event: makeEvent(3), now: 1 });
    s = metricsReducer(s, { type: "event", event: makeEvent(2), now: 2 });
    expect(s.latest!.sequence).toBe(3);
    expect(s.history).toHaveLength(1);
  });

  it("becomes stale after 3 missed intervals and recovers on the next event", () => {
    let s = metricsReducer(initialMetricsState(), { type: "event", event: makeEvent(0), now: 1_000 });
    s = metricsReducer(s, { type: "tick", now: 3_900 });
    expect(s.status).toBe("live");
    s = metricsReducer(s, { type: "tick", now: 4_100 });
    expect(s.status).toBe("stale");
    s = metricsReducer(s, { type: "event", event: makeEvent(1), now: 4_200 });
    expect(s.status).toBe("live");
  });

  it("reports errors and clears them when data arrives", () => {
    let s = metricsReducer(initialMetricsState(), { type: "error", error: { kind: "internal", message: "boom" } });
    expect(s.status).toBe("error");
    s = metricsReducer(s, { type: "info", info: makeSystemInfo() });
    expect(s.status).toBe("connecting");
    s = metricsReducer(s, { type: "event", event: makeEvent(0), now: 0 });
    expect(s.status).toBe("live");
    expect(s.error).toBeNull();
  });
});

describe("availability mapping", () => {
  it("maps stream status", () => {
    const base = { error: null, latest: null, receivedAt: 1_000 };
    expect(streamAvailability({ ...base, status: "connecting" }, 0).state).toBe("loading");
    expect(streamAvailability({ ...base, status: "live" }, 0).state).toBe("live");
    expect(streamAvailability({ ...base, status: "stale" }, 6_000)).toEqual({ state: "stale", ageSeconds: 5 });
    expect(
      streamAvailability({ ...base, status: "error", error: { kind: "no_backend", message: "x" } }, 0),
    ).toEqual({ state: "error", message: "x" });
  });

  it("maps readings", () => {
    expect(readingAvailability({ status: "ok", value: 1 })).toEqual({ state: "live" });
    expect(readingAvailability({ status: "unsupported", reason: "r" })).toEqual({ state: "unsupported", reason: "r" });
    expect(readingAvailability({ status: "error", message: "m" })).toEqual({ state: "error", message: "m" });
  });
});

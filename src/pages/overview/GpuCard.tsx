import { AvailabilityBadge, Card } from "../../design";

/** GPU collection is milestone 4. Until then this card says so and shows no value. */
export function GpuCard() {
  return (
    <Card title="GPU" actions={<AvailabilityBadge availability={{ state: "notImplemented", milestone: 4 }} />}>
      <p className="text-sm text-fg-muted">
        GPU monitoring is not implemented yet. Utilisation, VRAM and temperature will appear here where the
        hardware and drivers expose them.
      </p>
    </Card>
  );
}

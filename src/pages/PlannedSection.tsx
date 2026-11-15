import { AvailabilityBadge, Card, EmptyState, Icon, PageHeader } from "../design";
import { routeById, type RouteId } from "../navigation/routes";

export interface PlannedSectionProps {
  route: RouteId;
  milestone: number;
  features: readonly string[];
}

/**
 * Honest placeholder for a section whose data pipeline has not been built
 * yet. It shows no numbers at all — only what is planned and when.
 */
export function PlannedSection({ route, milestone, features }: PlannedSectionProps) {
  const def = routeById(route);
  return (
    <>
      <PageHeader
        title={def.label}
        description={def.description}
        actions={<AvailabilityBadge availability={{ state: "notImplemented", milestone }} />}
      />
      <Card>
        <EmptyState
          icon="construction"
          title={`${def.label} monitoring is not implemented yet`}
          description={`This section is scheduled for milestone ${milestone}. No measurements are shown until the backend collector exists.`}
        />
        <div className="mx-auto mb-6 max-w-md border-t border-line pt-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Planned</h3>
          <ul className="space-y-1.5">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-fg-muted">
                <Icon name="chevronRight" size={14} className="mt-[3px] shrink-0 text-fg-subtle" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}

import { ResourceCard } from "@/components/resource-card";
import type { Resource } from "@/lib/db/schema";

export function ResourceGrid({ resources }: { resources: Resource[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {resources.map((r, i) => (
        <ResourceCard key={r.id} r={r} index={i} />
      ))}
    </div>
  );
}

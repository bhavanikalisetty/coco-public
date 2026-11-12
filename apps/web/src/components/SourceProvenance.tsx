import { isFixture } from "../lib/graph";

export function SourceProvenance({
  properties,
}: {
  properties: Record<string, unknown>;
}) {
  return (
    <details className="source-details">
      <summary>Source details</summary>
      <dl>
        <dt>Source</dt>
        <dd>{String(properties.source ?? "Saved record")}</dd>
        <dt>Test record</dt>
        <dd>{isFixture(properties) ? "Yes" : "Not marked"}</dd>
      </dl>
    </details>
  );
}

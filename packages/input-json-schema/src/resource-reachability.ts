import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaReferenceKeywordsForDialect } from "./metadata";
import type { JsonSchemaDialect } from "./metadata";

type ReachableLocation = Readonly<{ id: string; schema: JsonSchemaValue }>;
type ReachableReference = Readonly<{ location: ReachableLocation }>;
type StringReferenceEntry = readonly [string, string];

type ResourceReachabilityRequest = Readonly<{
  children: (id: string) => readonly ReachableLocation[];
  dialectFor: (id: string) => JsonSchemaDialect;
  location: (id: string) => ReachableLocation | undefined;
  resolve: (input: Readonly<{ from: string; reference: string }>) => ReachableReference | undefined;
  root: string;
}>;

export const reachableResourceLocations = ({
  children,
  dialectFor,
  location,
  resolve,
  root,
}: ResourceReachabilityRequest): ReadonlySet<string> => {
  const reachable = new Set<string>([root]);
  const pending = [root];
  const addLocation = (id: string): void => {
    if (!reachable.has(id)) {
      reachable.add(id);
      pending.push(id);
    }
  };
  const addReferenceTargets = (id: string, schema: JsonSchemaValue): void => {
    if (!isJsonObject(schema)) return;
    const referenceKeywords = jsonSchemaReferenceKeywordsForDialect(dialectFor(id));
    const entries: StringReferenceEntry[] = Object.entries(schema).flatMap(([key, value]) =>
      referenceKeywords.includes(key) && typeof value === "string" ? [[key, value]] : [],
    );
    for (const [, value] of entries) {
      const target = resolve({ from: id, reference: value });
      if (target !== undefined) addLocation(target.location.id);
    }
  };
  while (pending.length > 0) {
    const id = pending.pop();
    const current = id === undefined ? undefined : location(id);
    if (id !== undefined && current !== undefined) {
      addReferenceTargets(id, current.schema);
      for (const child of children(id)) addLocation(child.id);
    }
  }
  return reachable;
};

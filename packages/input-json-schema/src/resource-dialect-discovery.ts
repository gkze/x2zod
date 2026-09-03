import { defaultJsonSchemaDialectPolicy, resolveJsonSchemaDialectPolicy } from "./dialect";
import type { JsonSchemaValue } from "./document";
import { createJsonSchemaGraphMetaSchemaResolver } from "./meta-schema-resolution";
import type { JsonSchemaDialect } from "./metadata";
import type { JsonSchemaLocationId, JsonSchemaResourceGraph } from "./resource-graph";

export type JsonSchemaDialectResolutionGraph = Pick<
  JsonSchemaResourceGraph,
  "location" | "resolveUnique" | "resources"
>;

type ResolveJsonSchemaGraphDialectRequest = Readonly<{
  externalSchemas: Readonly<Record<string, JsonSchemaValue>>;
  from: JsonSchemaLocationId;
  graph?: JsonSchemaDialectResolutionGraph | undefined;
  inherited: JsonSchemaDialect;
  schema: JsonSchemaValue;
}>;

export const resolveJsonSchemaGraphDialect = ({
  externalSchemas,
  from,
  graph,
  inherited,
  schema,
}: ResolveJsonSchemaGraphDialectRequest): JsonSchemaDialect => {
  const resolveMetaSchema =
    graph === undefined
      ? undefined
      : createJsonSchemaGraphMetaSchemaResolver(externalSchemas, graph, from);
  const policy = resolveJsonSchemaDialectPolicy(schema, defaultJsonSchemaDialectPolicy(inherited), {
    externalSchemas,
    ...(resolveMetaSchema === undefined ? {} : { resolveMetaSchema }),
  });
  return policy.ok ? policy.value.dialect : inherited;
};

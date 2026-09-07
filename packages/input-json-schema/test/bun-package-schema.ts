import type { JsonSchemaValue } from "../src";

const catalog = { type: "object", additionalProperties: { type: "string" } } as const;
const catalogs = { type: "object", additionalProperties: catalog } as const;

// SchemaStore leaves these Bun-specific fields open. Compose their documented shape before lowering.
// https://bun.sh/docs/pm/catalogs — cross-package resolution remains Bun's responsibility.
export const bunPackageSchema: JsonSchemaValue = {
  allOf: [
    { $ref: "https://json.schemastore.org/package.json" },
    {
      type: "object",
      properties: {
        catalog,
        catalogs,
        workspaces: {
          anyOf: [{ type: "array" }, { type: "object", properties: { catalog, catalogs } }],
        },
      },
    },
  ],
};

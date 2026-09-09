import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { SourcePropertyKeyMapping } from "./source-model";
import type { ZodObjectProperty } from "./zod-plan";

export const projectObjectPropertyKey = (
  property: ZodObjectProperty,
  project: (key: string) => string,
): string => (property.keyTransform === "preserve" ? property.key : project(property.key));

export const propertyKeyCollision = (
  encodedKeys: readonly string[],
  decodedKey: (key: string) => string,
): Result<readonly SourcePropertyKeyMapping[]> => {
  const encodedByDecoded = new Map<string, string>();
  const mappings: SourcePropertyKeyMapping[] = [];

  for (const encodedKey of encodedKeys) {
    const projectedKey = decodedKey(encodedKey);
    const previous = encodedByDecoded.get(projectedKey);
    if (previous !== undefined && previous !== encodedKey)
      return err(
        createDiagnostic({
          code: "emission_transform_key_collision",
          message: [
            `Property-key transform maps both ${JSON.stringify(previous)}`,
            `and ${JSON.stringify(encodedKey)} to ${JSON.stringify(projectedKey)}.`,
          ].join(" "),
        }),
      );
    encodedByDecoded.set(projectedKey, encodedKey);
    if (projectedKey !== encodedKey) mappings.push({ decodedKey: projectedKey, encodedKey });
  }

  return ok(mappings);
};

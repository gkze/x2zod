import { zodDeclarationNameHint } from "@x2zod/core";
import type { JsonPointer, ZodDeclarationNameHint } from "@x2zod/core";

import { isJsonObject } from "./document";
import type { JsonSchemaValue } from "./document";
import { jsonSchemaKeywords } from "./metadata";
import { jsonSchemaPointerSegments } from "./pointer";

const previousSegmentOffset = 2;
const lastSegmentOffset = 1;

export const jsonSchemaDeclarationNameHints = (
  pointer: JsonPointer,
  schema: JsonSchemaValue,
): readonly ZodDeclarationNameHint[] => {
  const segments = jsonSchemaPointerSegments(pointer);
  const lastSegment = segments[segments.length - lastSegmentOffset];
  const previousSegment = segments[segments.length - previousSegmentOffset];
  const hints = [];
  const title = isJsonObject(schema) ? schema[jsonSchemaKeywords.title] : undefined;
  const anchor = isJsonObject(schema) ? schema[jsonSchemaKeywords.anchor] : undefined;
  if (typeof title === "string") hints.push(zodDeclarationNameHint(title, "title"));
  if (typeof anchor === "string") hints.push(zodDeclarationNameHint(anchor, "anchor"));
  if (lastSegment !== undefined)
    hints.push(
      zodDeclarationNameHint(
        lastSegment,
        previousSegment === jsonSchemaKeywords.dollarDefs ||
          previousSegment === jsonSchemaKeywords.definitions
          ? "definitionKey"
          : "pointer",
      ),
    );

  return hints;
};

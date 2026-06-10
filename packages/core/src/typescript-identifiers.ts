import {
  isIdentifierPart,
  isIdentifierText as isTypeScriptIdentifierText,
} from "@typescript/native-preview/ast";
import { z } from "zod/v4";

export type TypeScriptIdentifier = string & z.$brand<"TypeScriptIdentifier">;

const typeScriptIdentifierSchemaValue: z.ZodType<TypeScriptIdentifier, string> = z
  .string()
  .refine((value) => isTypeScriptIdentifier(value))
  .transform((value): TypeScriptIdentifier => value as TypeScriptIdentifier);

export const typeScriptIdentifierSchema: z.ZodType<TypeScriptIdentifier, string> =
  typeScriptIdentifierSchemaValue;

export const isTypeScriptIdentifier = (value: string): boolean => isTypeScriptIdentifierText(value);

export const typeScriptIdentifierSegments = (value: string): readonly string[] | undefined => {
  const segments: string[] = [];
  let currentSegment = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isIdentifierPart(codePoint)) currentSegment += character;
    else if (currentSegment.length > 0) {
      segments.push(currentSegment);
      currentSegment = "";
    }
  }

  if (currentSegment.length > 0) segments.push(currentSegment);

  return segments.length === 0 ? undefined : segments;
};

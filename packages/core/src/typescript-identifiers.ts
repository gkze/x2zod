import {
  isIdentifierPart,
  isIdentifierText as isTypeScriptIdentifierText,
  stringToToken,
  SyntaxKind,
} from "@typescript/native-preview/unstable/ast";
import { z } from "zod/v4";

export type TypeScriptIdentifier = string & z.$brand<"TypeScriptIdentifier">;

export type TypeScriptIdentifierAllocator = Readonly<{
  allocate: (candidate: string, nextCandidate?: (name: string) => string) => string;
}>;

export const createTypeScriptIdentifierAllocator = (
  initiallyReserved: Iterable<string> = [],
): TypeScriptIdentifierAllocator => {
  const usedNames = new Set(initiallyReserved);
  const allocate = (
    candidate: string,
    nextCandidate: (name: string) => string = (name) => `${name}X`,
  ): string => {
    let name = candidate;
    while (usedNames.has(name)) name = nextCandidate(name);
    usedNames.add(name);
    return name;
  };

  return { allocate };
};

const typeScriptIdentifierSchemaValue: z.ZodType<TypeScriptIdentifier, string> = z
  .string()
  .refine((value) => isTypeScriptIdentifier(value))
  .transform((value): TypeScriptIdentifier => value as TypeScriptIdentifier);

export const typeScriptIdentifierSchema: z.ZodType<TypeScriptIdentifier, string> =
  typeScriptIdentifierSchemaValue;

const isTypeScriptDeclarationNameToken = (token: SyntaxKind): boolean =>
  (token >= SyntaxKind.FirstReservedWord && token <= SyntaxKind.LastReservedWord) ||
  (token >= SyntaxKind.FirstFutureReservedWord && token <= SyntaxKind.LastFutureReservedWord) ||
  token === SyntaxKind.AsKeyword ||
  token === SyntaxKind.AwaitKeyword;

export const isTypeScriptIdentifier = (value: string): boolean => {
  if (!isTypeScriptIdentifierText(value)) return false;

  const token = stringToToken(value);
  return token === undefined || !isTypeScriptDeclarationNameToken(token);
};

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

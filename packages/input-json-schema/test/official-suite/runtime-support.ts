import { isDeepStrictEqual } from "node:util";

import type { RuntimeGapContract, RuntimeParseResult, RuntimeZodSchema } from "./runtime-contract";

export type ObservedRuntimeGap = RuntimeGapContract & Readonly<{ detail: string }>;
type RuntimeGapRequest = Readonly<{
  data: unknown;
  expectedValid: boolean;
  id: string;
  schema: RuntimeZodSchema;
}>;

const observedRuntimeGap = (
  request: RuntimeGapContract & Readonly<{ detail: string }>,
): ObservedRuntimeGap => {
  const [firstCode, ...remainingCodes] = [...request.codes].toSorted();
  if (firstCode === undefined) throw new Error("Runtime gaps require at least one code.");
  return {
    codes: [firstCode, ...remainingCodes],
    detail: request.detail,
    id: request.id,
    phase: request.phase,
  };
};

const parseRuntimeSchema = (
  schema: RuntimeZodSchema,
  value: unknown,
  id: string,
): RuntimeParseResult => {
  try {
    return schema.safeParse(value);
  } catch (error) {
    throw new Error(`Generated schema runtime failed for official suite case ${id}.`, {
      cause: error,
    });
  }
};

export const runtimeGap = ({
  data,
  expectedValid,
  id,
  schema,
}: RuntimeGapRequest): ObservedRuntimeGap | undefined => {
  const inputBaseline = structuredClone(data);
  const parseInput = structuredClone(data);

  const parsed = parseRuntimeSchema(schema, parseInput, id);
  if (!isDeepStrictEqual(parseInput, inputBaseline))
    return observedRuntimeGap({
      codes: ["input_mutation"],
      detail: "schema mutated input during parsing",
      id,
      phase: "runtime",
    });
  if (parsed.success !== expectedValid)
    return observedRuntimeGap({
      codes: ["validity_mismatch"],
      detail:
        `expected valid=${expectedValid.toString()}, ` +
        `received success=${parsed.success.toString()}`,
      id,
      phase: "runtime",
    });
  if (parsed.success && !isDeepStrictEqual(parsed.data, inputBaseline))
    return observedRuntimeGap({
      codes: ["parse_identity_mismatch"],
      detail: "valid input was transformed instead of preserving JSON identity",
      id,
      phase: "runtime",
    });
  return undefined;
};

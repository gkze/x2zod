import type { Options } from "ajv";

import { createDiagnostic, err, ok } from "@x2zod/core";
import type { Result } from "@x2zod/core";

import { analyzeAjvStandaloneSource } from "./ajv-standalone-source";
import { standaloneRuntimeDependencies } from "./standalone-runtime-preamble";

export const jsonSchemaRuntimeProgramId = "json-schema:root-validator" as const;

export const ajvStandaloneOptions: Options = {
  allErrors: true,
  code: { esm: true, lines: true, optimize: 2, source: true },
  coerceTypes: false,
  inlineRefs: false,
  logger: false,
  loopEnum: 1,
  loopRequired: 1,
  meta: false,
  ownProperties: true,
  removeAdditional: false,
  strict: false,
  useDefaults: false,
  validateFormats: false,
  validateSchema: false,
};

const supportedRuntimeDependencies: ReadonlySet<string> = new Set(
  Object.values(standaloneRuntimeDependencies),
);

export const normalizeAjvStandaloneSource = (source: string): Result<string> => {
  const analyzed = analyzeAjvStandaloneSource(source);
  const unsupported = analyzed.runtimeDependencies.filter(
    (dependency) => !supportedRuntimeDependencies.has(dependency),
  );
  return unsupported.length === 0
    ? ok(analyzed.normalizedSource)
    : err(
        createDiagnostic({
          code: "unsupported_keyword",
          message: `Ajv standalone output requires unsupported runtime dependencies: ${unsupported.join(
            ", ",
          )}.`,
        }),
      );
};

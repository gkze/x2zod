import { createDiagnostic, formatZodError } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { ZodRuntimeProgram } from "./runtime-program";
import { analyzeRuntimeProgramExpression } from "./runtime-program-closure";
import { compareCodeUnits } from "./string-order";
import { zodHelperRequestSchema } from "./zod-helpers";
import type {
  ZodArgument,
  ZodEmissionModule,
  ZodExpression,
  ZodFactoryExpression,
  ZodHelperArgument,
  ZodMethodCall,
  ZodSymbol,
} from "./zod-plan";
import {
  collectZodExpressionReferences,
  collectZodRuntimeProgramReferences,
  collectSameValueCyclicZodDeclarationPeers,
} from "./zod-plan-analysis";
import { zodFactoryMetadata, zodMethodMetadataFor } from "./zod-plan-metadata";
import type {
  ZodArgumentMetadata,
  ZodArrayElementKind,
  ZodFactoryName,
  ZodLiteralArgumentValueType,
} from "./zod-plan-metadata";
import { validateZodCallReceivers } from "./zod-plan-receiver-validation";
import type { ZodPlanValidationContext as ValidationContext } from "./zod-plan-receiver-validation";
import { validateZodRecordKey } from "./zod-record-key-validation";

type StringLiteralArgument = Readonly<{ kind: "literal"; value: string }>;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod IR node: ${JSON.stringify(value)}`);
};

const findDuplicateStrings = <TValue extends string>(
  values: readonly TValue[],
): readonly TValue[] => {
  const seen = new Set<TValue>();
  const duplicates = new Set<TValue>();
  for (const value of values)
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);

  return [...duplicates];
};

const findDuplicateSymbols = (
  declarations: ZodEmissionModule["declarations"],
): readonly ZodSymbol[] =>
  findDuplicateStrings(declarations.map((declaration) => declaration.symbol));

const runtimeProgramAnalysis = (
  program: ZodRuntimeProgram,
): Result<ReturnType<typeof analyzeRuntimeProgramExpression>> => {
  try {
    return ok(analyzeRuntimeProgramExpression(program.expression));
  } catch (error) {
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Runtime program ${program.id} could not be analyzed as a TypeScript expression AST: ${
          error instanceof Error ? error.message : "Unknown AST failure."
        }`,
      }),
    );
  }
};

const validateRuntimeProgram = (program: ZodRuntimeProgram): Result<ZodRuntimeProgram> => {
  const analysisResult = runtimeProgramAnalysis(program);
  if (!analysisResult.ok) return analysisResult;
  const analysis = analysisResult.value;
  if (!analysis.callable)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Runtime program ${program.id} must be a synchronous predicate function or a zero-argument initializer with one final direct predicate return.`,
      }),
    );
  if (!analysis.abiCompatible)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Runtime program ${program.id} must implement the (unknown) => boolean predicate ABI.`,
      }),
    );
  if (analysis.forbiddenSyntax.length > 0)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Runtime program ${program.id} uses forbidden ambient syntax: ${analysis.forbiddenSyntax.join(
          ", ",
        )}.`,
      }),
    );
  if (analysis.freeIdentifiers.length > 0)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Runtime program ${program.id} references undeclared identifiers: ${analysis.freeIdentifiers.join(
          ", ",
        )}.`,
      }),
    );
  return ok(program);
};

const invalidFactoryArgs = (factory: ZodFactoryName, expected: string): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod factory ${factory} expects ${expected}.`,
    }),
  );

const invalidMethodArgs = (method: ZodMethodCall["method"], expected: string): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod method ${method} expects ${expected}.`,
    }),
  );

const unsupportedMethod = (method: ZodMethodCall["method"]): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod method ${method} is not supported by the emission model.`,
    }),
  );

const invalidWrapperExpression = (wrapper: string): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod wrapper ${wrapper} expects a direct Zod object expression with valid required own keys.`,
    }),
  );

const invalidWrapperOwnKeys = (wrapper: string, keys: readonly string[]): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod wrapper ${wrapper} has invalid required own keys: ${keys.join(", ")}`,
    }),
  );

const duplicateObjectKeys = (keys: readonly string[]): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod object shape contains duplicate keys: ${keys.join(", ")}`,
    }),
  );

const validateHelperRequest = (argument: ZodHelperArgument): Result<ZodArgument> => {
  const parsed = zodHelperRequestSchema.safeParse(argument.request);
  return parsed.success
    ? ok(argument)
    : err(
        createDiagnostic({
          code: "invalid_zod_emission_module",
          message: `Zod helper request is invalid: ${formatZodError(parsed.error)}`,
        }),
      );
};

const isStringLiteralArgument = (argument: ZodArgument): argument is StringLiteralArgument =>
  argument.kind === "literal" && typeof argument.value === "string";

const arrayArgumentValues = (
  args: readonly ZodArgument[],
  elementKind: ZodArrayElementKind,
): readonly string[] | undefined => {
  const [argument] = args;
  if (argument?.kind !== "array") return undefined;
  if (elementKind === "expression")
    return argument.elements.every((element) => element.kind === "expression") ? [] : undefined;

  const values = argument.elements.filter(isStringLiteralArgument);
  return values.length === argument.elements.length
    ? values.map((element) => element.value)
    : undefined;
};

const literalArgumentMatchesType = (
  argument: ZodArgument | undefined,
  valueType: ZodLiteralArgumentValueType,
): boolean => argument?.kind === "literal" && typeof argument.value === valueType;

const validRegExpFlags = (value: string): boolean =>
  /^[dgimsuvy]*$/u.test(value) &&
  new Set(value).size === value.length &&
  !(value.includes("u") && value.includes("v"));

const isSingleArgument = (args: readonly ZodArgument[], kind: ZodArgument["kind"]): boolean =>
  args.length === 1 && args[0]?.kind === kind;

const isArgumentSequence = (
  args: readonly ZodArgument[],
  kinds: readonly ZodArgument["kind"][],
): boolean =>
  args.length === kinds.length && args.every((argument, index) => argument.kind === kinds[index]);

const argumentsMatchMetadata = (
  args: readonly ZodArgument[],
  metadata: ZodArgumentMetadata,
): boolean => {
  switch (metadata.kind) {
    case "array": {
      const [argument] = args;
      const values = arrayArgumentValues(args, metadata.elementKind);
      return (
        args.length === 1 &&
        argument?.kind === "array" &&
        argument.elements.length >= metadata.minimumLength &&
        (metadata.maximumLength === undefined ||
          argument.elements.length <= metadata.maximumLength) &&
        values !== undefined
      );
    }
    case "literal": {
      const [argument] = args;
      return args.length === 1 && literalArgumentMatchesType(argument, metadata.valueType);
    }
    case "none": {
      return args.length === 0;
    }
    case "regex": {
      const [pattern, flags] = args;
      return (
        (args.length === 1 || args.length === 2) &&
        pattern !== undefined &&
        isStringLiteralArgument(pattern) &&
        (flags === undefined || (isStringLiteralArgument(flags) && validRegExpFlags(flags.value)))
      );
    }
    case "single": {
      return isSingleArgument(args, metadata.argumentKind);
    }
    case "sequence": {
      return isArgumentSequence(args, metadata.argumentKinds);
    }
    default: {
      return assertNever(metadata);
    }
  }
};

const duplicateStringArrayArgumentValues = (
  args: readonly ZodArgument[],
  metadata: ZodArgumentMetadata,
): readonly string[] => {
  if (metadata.kind !== "array" || metadata.unique !== true) return [];

  const values = arrayArgumentValues(args, metadata.elementKind);
  return values === undefined ? [] : findDuplicateStrings(values);
};

const validateArgumentShape = (
  argument: ZodArgument,
  context: ValidationContext,
): Result<ZodArgument> => {
  switch (argument.kind) {
    case "array": {
      const invalidElement = argument.elements
        .map((element) => validateArgumentShape(element, context))
        .find((result) => !result.ok);
      return invalidElement ?? ok(argument);
    }
    case "expression": {
      const validExpression = validateExpressionShape(argument.expression, context);
      return validExpression.ok ? ok(argument) : validExpression;
    }
    case "helper": {
      return validateHelperRequest(argument);
    }
    case "literal": {
      return ok(argument);
    }
    case "object": {
      const duplicateKeys = findDuplicateStrings(
        argument.properties.map((property) => property.key),
      );
      if (duplicateKeys.length > 0) return duplicateObjectKeys(duplicateKeys);

      const invalidProperty = argument.properties
        .map((property) => validateExpressionShape(property.expression, context))
        .find((result) => !result.ok);
      return invalidProperty ?? ok(argument);
    }
    default: {
      return assertNever(argument);
    }
  }
};

const validateCallShape = (
  call: ZodMethodCall,
  context: ValidationContext,
): Result<ZodMethodCall> => {
  const metadata = zodMethodMetadataFor(call.method);
  if (metadata === undefined) return unsupportedMethod(call.method);
  if (!argumentsMatchMetadata(call.args, metadata.args))
    return invalidMethodArgs(call.method, metadata.args.expected);

  const duplicateValues = duplicateStringArrayArgumentValues(call.args, metadata.args);
  if (duplicateValues.length > 0) return duplicateObjectKeys(duplicateValues);

  const invalidArgument = call.args
    .map((argument) => validateArgumentShape(argument, context))
    .find((result) => !result.ok);
  return invalidArgument ?? ok(call);
};

const validateCallShapes = (
  calls: readonly ZodMethodCall[],
  context: ValidationContext,
): Result<readonly ZodMethodCall[]> => {
  const invalidCall = calls
    .map((call) => validateCallShape(call, context))
    .find((result) => !result.ok);
  return invalidCall ?? ok(calls);
};

const validateFactoryArgs = (expression: ZodFactoryExpression): Result<ZodFactoryExpression> => {
  const metadata = zodFactoryMetadata[expression.factory];
  return argumentsMatchMetadata(expression.args, metadata.args)
    ? ok(expression)
    : invalidFactoryArgs(expression.factory, metadata.args.expected);
};

const validateExpressionShape = (
  expression: ZodExpression,
  context: ValidationContext,
): Result<ZodExpression> => {
  const validCalls = validateCallShapes(expression.calls, context);
  if (!validCalls.ok) return validCalls;
  if (expression.kind === "reference") return validateZodCallReceivers(expression, context);
  if (expression.kind === "runtime-guard") {
    const validExpression = validateExpressionShape(expression.expression, context);
    return validExpression.ok ? validateZodCallReceivers(expression, context) : validExpression;
  }
  if (expression.kind === "wrapper") {
    const validExpression = validateExpressionShape(expression.expression, context);
    if (!validExpression.ok) return validExpression;
    if (expression.expression.kind !== "factory" || expression.expression.factory !== "object")
      return invalidWrapperExpression(expression.wrapper);
    if (
      expression.expression.calls.some(
        (call) => zodMethodMetadataFor(call.method)?.wrapsReceiver === true,
      )
    )
      return invalidWrapperExpression(expression.wrapper);
    const [shape] = expression.expression.args;
    if (shape?.kind !== "object") return invalidWrapperExpression(expression.wrapper);

    const duplicateOwnKeys = findDuplicateStrings(expression.requiredOwnKeys);
    if (duplicateOwnKeys.length > 0)
      return invalidWrapperOwnKeys(expression.wrapper, duplicateOwnKeys);

    const shapeKeys = new Set(shape.properties.map((property) => property.key));
    const missingOwnKeys = expression.requiredOwnKeys.filter((key) => !shapeKeys.has(key));
    if (missingOwnKeys.length > 0) return invalidWrapperOwnKeys(expression.wrapper, missingOwnKeys);

    return validateZodCallReceivers(expression, context);
  }

  const validFactoryArgs = validateFactoryArgs(expression);
  if (!validFactoryArgs.ok) return validFactoryArgs;

  const invalidArgument = expression.args
    .map((argument) => validateArgumentShape(argument, context))
    .find((result) => !result.ok);
  if (invalidArgument !== undefined) return invalidArgument;
  const validRecordKey = validateZodRecordKey(expression, context);
  if (!validRecordKey.ok) return validRecordKey;

  return validateZodCallReceivers(expression, context);
};

export const validateZodEmissionModule = (module: ZodEmissionModule): Result<ZodEmissionModule> => {
  const duplicateSymbols = findDuplicateSymbols(module.declarations);
  if (duplicateSymbols.length > 0)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module contains duplicate declaration symbols: ${duplicateSymbols.join(
          ", ",
        )}`,
      }),
    );

  const duplicateRuntimeProgramIds = findDuplicateStrings(
    module.runtimePrograms.map((program) => program.id),
  );
  if (duplicateRuntimeProgramIds.length > 0)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module contains duplicate runtime program IDs: ${duplicateRuntimeProgramIds.join(
          ", ",
        )}`,
      }),
    );

  const invalidRuntimeProgram = module.runtimePrograms
    .toSorted((left, right) => compareCodeUnits(left.id, right.id))
    .map((program) => validateRuntimeProgram(program))
    .find((result) => !result.ok);
  if (invalidRuntimeProgram !== undefined) return invalidRuntimeProgram;

  const declaredSymbols = new Set(module.declarations.map((declaration) => declaration.symbol));
  if (!declaredSymbols.has(module.root))
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module root is not declared: ${module.root}`,
      }),
    );

  const expressions = module.declarations.flatMap((declaration) => [
    declaration.expression,
    ...(declaration.exportExpression === undefined ? [] : [declaration.exportExpression]),
  ]);
  const unresolvedReferences = expressions
    .flatMap((expression) => collectZodExpressionReferences(expression))
    .filter((symbol) => !declaredSymbols.has(symbol));
  if (unresolvedReferences.length > 0)
    return err(
      createDiagnostic({
        code: "unresolved_reference",
        message: `Zod emission module references undeclared symbols: ${[
          ...new Set(unresolvedReferences),
        ].join(", ")}`,
      }),
    );

  const runtimeProgramIds = new Set(module.runtimePrograms.map((program) => program.id));
  const unresolvedRuntimePrograms = expressions
    .flatMap((expression) => collectZodRuntimeProgramReferences(expression))
    .filter((program) => !runtimeProgramIds.has(program));
  if (unresolvedRuntimePrograms.length > 0)
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module references undeclared runtime programs: ${[
          ...new Set(unresolvedRuntimePrograms),
        ].join(", ")}`,
      }),
    );

  const context: ValidationContext = {
    declarations: new Map(
      module.declarations.map((declaration) => [declaration.symbol, declaration]),
    ),
  };
  const invalidDeclaration = expressions
    .map((expression) => validateExpressionShape(expression, context))
    .find((result) => !result.ok);
  if (invalidDeclaration !== undefined) return invalidDeclaration;

  const cyclicSymbols = [...collectSameValueCyclicZodDeclarationPeers(module).keys()];
  return cyclicSymbols.length === 0
    ? ok(module)
    : err(
        createDiagnostic({
          code: "cyclic_reference",
          message: `Zod emission module contains non-terminating same-value declaration references: ${cyclicSymbols.join(
            ", ",
          )}`,
        }),
      );
};

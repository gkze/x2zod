import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type {
  ZodArgument,
  ZodEmissionModule,
  ZodExpression,
  ZodFactoryExpression,
  ZodMethodCall,
  ZodSymbol,
} from "./zod-plan";
import { collectZodExpressionReferences } from "./zod-plan-analysis";
import { zodFactoryMetadata, zodMethodMetadataFor } from "./zod-plan-metadata";
import type {
  ZodArgumentMetadata,
  ZodArrayElementKind,
  ZodFactoryName,
  ZodLiteralArgumentValueType,
} from "./zod-plan-metadata";
import { validateZodCallReceivers } from "./zod-plan-receiver-validation";
import type { ZodPlanValidationContext as ValidationContext } from "./zod-plan-receiver-validation";

const asciiSpace = 32;
const asciiHyphen = 45;
const asciiGreaterThan = 62;
const referenceCycleSeparator = String.fromCodePoint(
  asciiSpace,
  asciiHyphen,
  asciiGreaterThan,
  asciiSpace,
);

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

const duplicateObjectKeys = (keys: readonly string[]): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod object shape contains duplicate keys: ${keys.join(", ")}`,
    }),
  );

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

  const validFactoryArgs = validateFactoryArgs(expression);
  if (!validFactoryArgs.ok) return validFactoryArgs;

  const invalidArgument = expression.args
    .map((argument) => validateArgumentShape(argument, context))
    .find((result) => !result.ok);
  if (invalidArgument !== undefined) return invalidArgument;

  return validateZodCallReceivers(expression, context);
};

const findReferenceCycle = (module: ZodEmissionModule): readonly ZodSymbol[] | undefined => {
  const declarationsBySymbol = new Map(
    module.declarations.map((declaration) => [declaration.symbol, declaration]),
  );
  const visited = new Set<ZodSymbol>();
  const visiting = new Set<ZodSymbol>();
  const stack: ZodSymbol[] = [];

  const visit = (symbol: ZodSymbol): readonly ZodSymbol[] | undefined => {
    if (visiting.has(symbol)) return [...stack.slice(stack.indexOf(symbol)), symbol];
    if (visited.has(symbol)) return undefined;

    const declaration = declarationsBySymbol.get(symbol);
    if (declaration === undefined) return undefined;

    visiting.add(symbol);
    stack.push(symbol);

    for (const reference of collectZodExpressionReferences(declaration.expression)) {
      const cycle = visit(reference);
      if (cycle !== undefined) return cycle;
    }

    stack.pop();
    visiting.delete(symbol);
    visited.add(symbol);
    return undefined;
  };

  for (const symbol of declarationsBySymbol.keys()) {
    const cycle = visit(symbol);
    if (cycle !== undefined) return cycle;
  }

  return undefined;
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

  const declaredSymbols = new Set(module.declarations.map((declaration) => declaration.symbol));
  if (!declaredSymbols.has(module.root))
    return err(
      createDiagnostic({
        code: "invalid_zod_emission_module",
        message: `Zod emission module root is not declared: ${module.root}`,
      }),
    );

  const unresolvedReferences = module.declarations
    .flatMap((declaration) => collectZodExpressionReferences(declaration.expression))
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

  const referenceCycle = findReferenceCycle(module);
  if (referenceCycle !== undefined)
    return err(
      createDiagnostic({
        code: "cyclic_reference",
        message: [
          "Zod emission module contains a cyclic reference:",
          referenceCycle.join(referenceCycleSeparator),
        ].join(" "),
      }),
    );

  const context: ValidationContext = {
    declarations: new Map(
      module.declarations.map((declaration) => [declaration.symbol, declaration]),
    ),
  };
  const invalidDeclaration = module.declarations
    .map((declaration) => validateExpressionShape(declaration.expression, context))
    .find((result) => !result.ok);
  return invalidDeclaration ?? ok(module);
};

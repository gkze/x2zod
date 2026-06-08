import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type {
  ZodArgument,
  ZodEmissionModule,
  ZodExpression,
  ZodFactoryExpression,
  ZodFactoryName,
  ZodMethodCall,
  ZodSymbol,
} from "./zod-plan";
import { collectZodExpressionReferences } from "./zod-plan-analysis";

const minimumUnionOptions = 2;
const asciiSpace = 32;
const asciiHyphen = 45;
const asciiGreaterThan = 62;
const referenceCycleSeparator = String.fromCodePoint(
  asciiSpace,
  asciiHyphen,
  asciiGreaterThan,
  asciiSpace,
);
const unionFactoryExpectedArguments = ["an array of at least two", "expression arguments"].join(
  " ",
);
const noArgumentMethods = new Set<string>(["nullable", "optional"]);

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

const noArgumentFactories = new Set<ZodFactoryName>([
  "boolean",
  "never",
  "null",
  "number",
  "string",
  "unknown",
]);

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

const validateArgumentShape = (argument: ZodArgument): Result<ZodArgument> => {
  switch (argument.kind) {
    case "array": {
      const invalidElement = argument.elements
        .map(validateArgumentShape)
        .find((result) => !result.ok);
      return invalidElement ?? ok(argument);
    }
    case "expression": {
      const validExpression = validateExpressionShape(argument.expression);
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
        .map((property) => validateExpressionShape(property.expression))
        .find((result) => !result.ok);
      return invalidProperty ?? ok(argument);
    }
    default: {
      return assertNever(argument);
    }
  }
};

const validateCallShapes = (calls: readonly ZodMethodCall[]): Result<readonly ZodMethodCall[]> => {
  const invalidCall = calls.map((call) => validateCallShape(call)).find((result) => !result.ok);
  return invalidCall ?? ok(calls);
};

const validateCallShape = (call: ZodMethodCall): Result<ZodMethodCall> => {
  if (!noArgumentMethods.has(call.method)) return unsupportedMethod(call.method);
  if (call.args.length > 0) return invalidMethodArgs(call.method, "no arguments");

  const invalidArgument = call.args.map(validateArgumentShape).find((result) => !result.ok);
  return invalidArgument ?? ok(call);
};

const isSingleArgument = (args: readonly ZodArgument[], kind: ZodArgument["kind"]): boolean =>
  args.length === 1 && args[0]?.kind === kind;

const validateNoArgumentFactory = (
  expression: ZodFactoryExpression,
): Result<ZodFactoryExpression> =>
  expression.args.length === 0
    ? ok(expression)
    : invalidFactoryArgs(expression.factory, "no arguments");

const validateUnionFactory = (expression: ZodFactoryExpression): Result<ZodFactoryExpression> => {
  const [unionArgs] = expression.args;
  return expression.args.length === 1 &&
    unionArgs?.kind === "array" &&
    unionArgs.elements.length >= minimumUnionOptions &&
    unionArgs.elements.every((element) => element.kind === "expression")
    ? ok(expression)
    : invalidFactoryArgs(expression.factory, unionFactoryExpectedArguments);
};

const validateFactoryArgs = (expression: ZodFactoryExpression): Result<ZodFactoryExpression> => {
  if (noArgumentFactories.has(expression.factory)) return validateNoArgumentFactory(expression);
  if (expression.factory === "array")
    return validateSingleArgumentFactory(expression, "expression");
  if (expression.factory === "literal") return validateSingleArgumentFactory(expression, "literal");
  if (expression.factory === "object") return validateSingleArgumentFactory(expression, "object");
  if (expression.factory === "union") return validateUnionFactory(expression);
  return ok(expression);
};

const validateSingleArgumentFactory = (
  expression: ZodFactoryExpression,
  kind: ZodArgument["kind"],
): Result<ZodFactoryExpression> =>
  isSingleArgument(expression.args, kind)
    ? ok(expression)
    : invalidFactoryArgs(expression.factory, `one ${kind} argument`);

const validateExpressionShape = (expression: ZodExpression): Result<ZodExpression> => {
  const validCalls = validateCallShapes(expression.calls);
  if (!validCalls.ok) return validCalls;
  if (expression.kind === "reference") return ok(expression);

  const validFactoryArgs = validateFactoryArgs(expression);
  if (!validFactoryArgs.ok) return validFactoryArgs;

  const invalidArgument = expression.args.map(validateArgumentShape).find((result) => !result.ok);
  return invalidArgument ?? ok(expression);
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

  const invalidDeclaration = module.declarations
    .map((declaration) => validateExpressionShape(declaration.expression))
    .find((result) => !result.ok);
  return invalidDeclaration ?? ok(module);
};

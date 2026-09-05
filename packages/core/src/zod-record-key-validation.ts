import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { ZodExpression, ZodFactoryExpression, ZodLiteralValue, ZodSymbol } from "./zod-plan";
import type { ZodPlanValidationContext } from "./zod-plan-receiver-validation";

type ValueDomain = "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined";
const allDomains: ReadonlySet<ValueDomain> = new Set([
  "array",
  "boolean",
  "null",
  "number",
  "object",
  "string",
  "undefined",
]);

const literalDomain = (value: ZodLiteralValue): ValueDomain => {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  return typeof value === "string" ? "string" : "number";
};

const factoryDomains = (
  expression: ZodFactoryExpression,
  nested: (child: ZodExpression) => ReadonlySet<ValueDomain>,
): ReadonlySet<ValueDomain> => {
  const children = expression.args.flatMap((argument) => {
    if (argument.kind === "expression") return [nested(argument.expression)];
    if (argument.kind === "array")
      return argument.elements.flatMap((element) =>
        element.kind === "expression" ? [nested(element.expression)] : [],
      );
    return [];
  });
  switch (expression.factory) {
    case "never": {
      return new Set();
    }
    case "string":
    case "number":
    case "boolean":
    case "null": {
      return new Set([expression.factory]);
    }
    case "enum": {
      return new Set(["string"]);
    }
    case "array":
    case "tuple": {
      return new Set(["array"]);
    }
    case "object":
    case "record": {
      return new Set(["object"]);
    }
    case "unknown": {
      return allDomains;
    }
    case "literal": {
      const [argument] = expression.args;
      return argument?.kind === "literal" ? new Set([literalDomain(argument.value)]) : allDomains;
    }
    case "union":
    case "xor": {
      return new Set(children.flatMap((child) => [...child]));
    }
    case "intersection": {
      return new Set(
        [...allDomains].filter((domain) => children.every((child) => child.has(domain))),
      );
    }
    default: {
      const unexpected: never = expression.factory;
      throw new Error(`Unexpected Zod factory: ${String(unexpected)}`);
    }
  }
};

const outputDomains = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
  visiting: ReadonlySet<ZodSymbol> = new Set(),
): ReadonlySet<ValueDomain> => {
  const nested = (child: ZodExpression): ReadonlySet<ValueDomain> =>
    outputDomains(child, context, visiting);
  let domains: ReadonlySet<ValueDomain> = allDomains;
  if (expression.kind === "reference") {
    const declaration = context.declarations.get(expression.symbol);
    if (declaration !== undefined && !visiting.has(expression.symbol))
      domains = outputDomains(
        declaration.expression,
        context,
        new Set([...visiting, expression.symbol]),
      );
  } else if (expression.kind === "runtime-guard") domains = nested(expression.expression);
  else if (expression.kind === "wrapper") domains = new Set(["object"]);
  else domains = factoryDomains(expression, nested);
  return new Set([
    ...domains,
    ...expression.calls.flatMap((call): ValueDomain[] => {
      if (call.method === "optional") return ["undefined"];
      if (call.method === "nullable") return ["null"];
      return [];
    }),
  ]);
};

export const validateZodRecordKey = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
): Result<ZodExpression> => {
  if (expression.kind !== "factory" || expression.factory !== "record") return ok(expression);
  const [key] = expression.args;
  if (key?.kind !== "expression") return ok(expression);
  return [...outputDomains(key.expression, context)].every(
    (domain) => domain === "string" || domain === "number",
  )
    ? ok(expression)
    : err(
        createDiagnostic({
          code: "invalid_zod_emission_module",
          message: "Zod record keys must have a string or number output type.",
        }),
      );
};

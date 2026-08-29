import type { ZodHelperName, ZodHelperRequest, ZodWrapperName } from "./zod-helpers";
import type { ZodDeclarationNameHint, ZodLiteralValue, ZodMethodName, ZodSymbol } from "./zod-plan";
import type { ZodFactoryName } from "./zod-plan-metadata";

export type SourcePropertyKeyMapping = Readonly<{ decodedKey: string; encodedKey: string }>;
export type SourceMethodCall = Readonly<{ args: readonly SourceArgument[]; method: ZodMethodName }>;
export type SourceObjectProperty = Readonly<{ expression: SourceExpression; key: string }>;
export type SourceArgument =
  | Readonly<{ elements: readonly SourceArgument[]; kind: "array" }>
  | Readonly<{ expression: SourceExpression; kind: "expression" }>
  | Readonly<{ kind: "helper"; request: ZodHelperRequest }>
  | Readonly<{ kind: "literal"; value: ZodLiteralValue }>
  | Readonly<{ kind: "object"; properties: readonly SourceObjectProperty[] }>;
export type SourceFactoryExpression = Readonly<{
  args: readonly SourceArgument[];
  calls: readonly SourceMethodCall[];
  factory: ZodFactoryName;
  kind: "factory";
}>;
export type SourceReferenceExpression = Readonly<{
  calls: readonly SourceMethodCall[];
  kind: "reference";
  outputView: boolean;
  symbol: ZodSymbol;
}>;
export type SourceWrapperExpression = Readonly<{
  calls: readonly SourceMethodCall[];
  expression: SourceExpression;
  kind: "wrapper";
  requiredOwnKeys: readonly string[];
  wrapper: ZodWrapperName;
}>;
export type SourceWrapperExpressionInput = Readonly<{
  calls: readonly SourceMethodCall[];
  expression: SourceExpression;
  requiredOwnKeys: readonly string[];
  wrapper: ZodWrapperName;
}>;
export const sourceWrapperExpression = (
  input: SourceWrapperExpressionInput,
): SourceWrapperExpression => ({ ...input, kind: "wrapper" });
export type SourceCodecOperation =
  | Readonly<{ kind: "identity" }>
  | Readonly<{ kind: "map-properties"; mappings: readonly SourcePropertyKeyMapping[] }>;
export type SourceCodecExpression = Readonly<{
  calls: readonly SourceMethodCall[];
  input: SourceExpression;
  kind: "codec";
  operation: SourceCodecOperation;
  output: SourceExpression;
}>;
export type SourceExpression =
  | SourceCodecExpression
  | SourceFactoryExpression
  | SourceReferenceExpression
  | SourceWrapperExpression;
export type SourceDeclaration = Readonly<{
  expression: SourceExpression;
  nameHints: readonly ZodDeclarationNameHint[];
  symbol: ZodSymbol;
}>;
export type SourceEmissionModule = Readonly<{
  declarations: readonly SourceDeclaration[];
  root: ZodSymbol;
}>;

export const sourceExpressionUsesPropertyMap = (expression: SourceExpression): boolean => {
  const expressions = [expression];
  const argumentsToVisit: SourceArgument[] = [];

  while (expressions.length > 0 || argumentsToVisit.length > 0) {
    const currentExpression = expressions.pop();
    if (currentExpression === undefined) {
      const argument = argumentsToVisit.pop();
      if (argument?.kind === "array") argumentsToVisit.push(...argument.elements);
      else if (argument?.kind === "expression") expressions.push(argument.expression);
      else if (argument?.kind === "object")
        expressions.push(...argument.properties.map((property) => property.expression));
    } else {
      argumentsToVisit.push(...currentExpression.calls.flatMap((call) => call.args));
      if (currentExpression.kind === "codec") {
        if (currentExpression.operation.kind === "map-properties") return true;
        expressions.push(currentExpression.input, currentExpression.output);
      } else if (currentExpression.kind === "factory")
        argumentsToVisit.push(...currentExpression.args);
      else if (currentExpression.kind === "wrapper") expressions.push(currentExpression.expression);
    }
  }

  return false;
};

export const sourceExpressionHelperNames = (
  expression: SourceExpression,
): ReadonlySet<ZodHelperName> => {
  const helpers = new Set<ZodHelperName>();
  const expressions = [expression];
  const argumentsToVisit: SourceArgument[] = [];

  while (expressions.length > 0 || argumentsToVisit.length > 0) {
    const currentExpression = expressions.pop();
    if (currentExpression === undefined) {
      const argument = argumentsToVisit.pop();
      if (argument?.kind === "array") argumentsToVisit.push(...argument.elements);
      else if (argument?.kind === "expression") expressions.push(argument.expression);
      else if (argument?.kind === "helper") helpers.add(argument.request.helper);
      else if (argument?.kind === "object")
        expressions.push(...argument.properties.map((property) => property.expression));
    } else {
      argumentsToVisit.push(...currentExpression.calls.flatMap((call) => call.args));
      if (currentExpression.kind === "codec")
        expressions.push(currentExpression.input, currentExpression.output);
      else if (currentExpression.kind === "factory")
        argumentsToVisit.push(...currentExpression.args);
      else if (currentExpression.kind === "wrapper") {
        helpers.add(currentExpression.wrapper);
        expressions.push(currentExpression.expression);
      }
    }
  }

  return helpers;
};

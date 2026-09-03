import type { ZodRuntimeProgramId } from "./runtime-program";
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
  symbol: ZodSymbol;
  view: "input" | "output" | "schema";
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
export type SourceRuntimeGuardExpression = Readonly<{
  calls: readonly SourceMethodCall[];
  expression: SourceExpression;
  kind: "runtime-guard";
  parseStructural: boolean;
  program: ZodRuntimeProgramId;
}>;
export type SourceRuntimeGuardExpressionInput = Readonly<{
  calls: readonly SourceMethodCall[];
  expression: SourceExpression;
  parseStructural: boolean;
  program: ZodRuntimeProgramId;
}>;
export const sourceRuntimeGuardExpression = (
  input: SourceRuntimeGuardExpressionInput,
): SourceRuntimeGuardExpression => ({ ...input, kind: "runtime-guard" });
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
  | SourceRuntimeGuardExpression
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

export type SourceExpressionAnalysis = Readonly<{
  helperNames: ReadonlySet<ZodHelperName>;
  runtimeGuardParseModes: ReadonlySet<boolean>;
  usesPropertyMap: boolean;
}>;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected source emission node: ${JSON.stringify(value)}`);
};

export const analyzeSourceExpression = (expression: SourceExpression): SourceExpressionAnalysis => {
  const helperNames = new Set<ZodHelperName>();
  const runtimeGuardParseModes = new Set<boolean>();
  let usesPropertyMap = false;
  const expressions = [expression];
  const argumentsToVisit: SourceArgument[] = [];

  while (expressions.length > 0 || argumentsToVisit.length > 0) {
    const currentExpression = expressions.pop();
    if (currentExpression === undefined) {
      const argument = argumentsToVisit.pop();
      if (argument !== undefined)
        switch (argument.kind) {
          case "array": {
            argumentsToVisit.push(...argument.elements);
            break;
          }
          case "expression": {
            expressions.push(argument.expression);
            break;
          }
          case "helper": {
            helperNames.add(argument.request.helper);
            break;
          }
          case "literal": {
            break;
          }
          case "object": {
            expressions.push(...argument.properties.map((property) => property.expression));
            break;
          }
          default: {
            assertNever(argument);
          }
        }
    } else {
      argumentsToVisit.push(...currentExpression.calls.flatMap((call) => call.args));
      switch (currentExpression.kind) {
        case "codec": {
          usesPropertyMap ||= currentExpression.operation.kind === "map-properties";
          expressions.push(currentExpression.input, currentExpression.output);
          break;
        }
        case "factory": {
          argumentsToVisit.push(...currentExpression.args);
          break;
        }
        case "reference": {
          break;
        }
        case "runtime-guard": {
          runtimeGuardParseModes.add(currentExpression.parseStructural);
          expressions.push(currentExpression.expression);
          break;
        }
        case "wrapper": {
          helperNames.add(currentExpression.wrapper);
          expressions.push(currentExpression.expression);
          break;
        }
        default: {
          assertNever(currentExpression);
        }
      }
    }
  }

  return { helperNames, runtimeGuardParseModes, usesPropertyMap };
};

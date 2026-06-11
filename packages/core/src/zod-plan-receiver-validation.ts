import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import type { ZodDeclaration, ZodExpression, ZodMethodCall, ZodSymbol } from "./zod-plan";
import { zodMethodMetadataFor } from "./zod-plan-metadata";
import type { ZodFactoryName, ZodReceiverRequirement } from "./zod-plan-metadata";

const requiredKeysPrintStrategy = "requiredKeys";

export type ZodPlanValidationContext = Readonly<{
  declarations: ReadonlyMap<ZodSymbol, ZodDeclaration>;
}>;
type ReceiverKind = ZodFactoryName | "wrapped";

const invalidMethodReceiver = (method: ZodMethodCall["method"], expected: string): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod method ${method} expects ${expected}.`,
    }),
  );

const missingRequiredObjectKeys = (keys: readonly string[]): Result<never> =>
  err(
    createDiagnostic({
      code: "invalid_zod_emission_module",
      message: `Zod method required references keys that are not in the object shape: ${keys.join(
        ", ",
      )}`,
    }),
  );

const receiverDescription = (kind: ReceiverKind): string =>
  kind === "wrapped" ? "an unwrapped Zod schema" : `a Zod ${kind} schema`;

const receiverRequirementDescription = (receiver: ZodReceiverRequirement): string => {
  if (receiver === "arrayOrString") return "a Zod array or string schema receiver";
  return `a Zod ${receiver} schema receiver`;
};

const expectedReceiverDescription = (method: ZodMethodCall["method"]): string | undefined => {
  const receiver = zodMethodMetadataFor(method)?.receiver;
  return receiver === undefined || receiver === "any"
    ? undefined
    : receiverRequirementDescription(receiver);
};

const methodAllowsReceiverKind = (method: ZodMethodCall["method"], kind: ReceiverKind): boolean => {
  const receiver = zodMethodMetadataFor(method)?.receiver;
  return (
    receiver === undefined ||
    receiver === "any" ||
    receiver === kind ||
    (receiver === "arrayOrString" && (kind === "array" || kind === "string"))
  );
};

const receiverKindAfterCall = (call: ZodMethodCall, kind: ReceiverKind): ReceiverKind =>
  zodMethodMetadataFor(call.method)?.wrapsReceiver === true ? "wrapped" : kind;

const callWrapsReceiver = (call: ZodMethodCall): boolean =>
  zodMethodMetadataFor(call.method)?.wrapsReceiver === true;

const baseObjectShapeKeys = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
  visiting: ReadonlySet<ZodSymbol> = new Set<ZodSymbol>(),
): ReadonlySet<string> | undefined => {
  if (expression.kind === "factory") {
    if (expression.factory !== "object") return undefined;
    const [shape] = expression.args;
    return shape?.kind === "object"
      ? new Set(shape.properties.map((property) => property.key))
      : undefined;
  }
  if (visiting.has(expression.symbol)) return undefined;

  const declaration = context.declarations.get(expression.symbol);
  if (declaration === undefined) return undefined;

  return objectShapeKeys(
    declaration.expression,
    context,
    new Set([...visiting, expression.symbol]),
  );
};

const objectShapeKeys = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
  visiting: ReadonlySet<ZodSymbol> = new Set<ZodSymbol>(),
): ReadonlySet<string> | undefined => {
  const shapeKeys = baseObjectShapeKeys(expression, context, visiting);
  if (shapeKeys === undefined) return undefined;

  for (const call of expression.calls) if (callWrapsReceiver(call)) return undefined;

  return shapeKeys;
};

const applyReceiverCalls = (kind: ReceiverKind, calls: readonly ZodMethodCall[]): ReceiverKind => {
  let calledKind = kind;
  for (const call of calls) calledKind = receiverKindAfterCall(call, calledKind);
  return calledKind;
};

const finalReceiverKind = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
  visiting: ReadonlySet<ZodSymbol> = new Set<ZodSymbol>(),
): ReceiverKind | undefined => {
  const baseKind = baseReceiverKind(expression, context, visiting);
  return baseKind === undefined ? undefined : applyReceiverCalls(baseKind, expression.calls);
};

const baseReceiverKind = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
  visiting: ReadonlySet<ZodSymbol> = new Set<ZodSymbol>(),
): ReceiverKind | undefined => {
  if (expression.kind === "factory") return expression.factory;
  if (visiting.has(expression.symbol)) return undefined;

  const declaration = context.declarations.get(expression.symbol);
  if (declaration === undefined) return undefined;

  return finalReceiverKind(
    declaration.expression,
    context,
    new Set([...visiting, expression.symbol]),
  );
};

const requiredCallKeys = (call: ZodMethodCall): readonly string[] | undefined => {
  const [argument] = call.args;
  if (
    zodMethodMetadataFor(call.method)?.printArgument !== requiredKeysPrintStrategy ||
    argument?.kind !== "array"
  )
    return undefined;

  const keys: string[] = [];
  for (const element of argument.elements)
    if (element.kind === "literal" && typeof element.value === "string") keys.push(element.value);

  return keys;
};

const missingRequiredKeys = (
  call: ZodMethodCall,
  shapeKeys: ReadonlySet<string> | undefined,
): readonly string[] => {
  const keys = requiredCallKeys(call) ?? [];
  const missingKeys: string[] = [];
  for (const key of keys) if (!(shapeKeys?.has(key) ?? false)) missingKeys.push(key);

  return missingKeys;
};

export const validateZodCallReceivers = (
  expression: ZodExpression,
  context: ZodPlanValidationContext,
): Result<ZodExpression> => {
  let receiverKind = baseReceiverKind(expression, context);
  let shapeKeys = baseObjectShapeKeys(expression, context);

  for (const call of expression.calls) {
    if (receiverKind === undefined) return ok(expression);
    if (!methodAllowsReceiverKind(call.method, receiverKind))
      return invalidMethodReceiver(
        call.method,
        expectedReceiverDescription(call.method) ?? receiverDescription(receiverKind),
      );
    if (zodMethodMetadataFor(call.method)?.printArgument === requiredKeysPrintStrategy) {
      const missingKeys = missingRequiredKeys(call, shapeKeys);
      if (missingKeys.length > 0) return missingRequiredObjectKeys(missingKeys);
    }
    receiverKind = receiverKindAfterCall(call, receiverKind);
    shapeKeys = receiverKind === "object" ? shapeKeys : undefined;
  }

  return ok(expression);
};

import { ok } from "./result";
import type { Result } from "./result";
import { sourceRuntimeGuardExpression } from "./source-model";
import type { SourceExpression, SourceMethodCall } from "./source-model";
import type { ZodExpression, ZodMethodCall } from "./zod-plan";

export type ExpressionProjection = Readonly<{
  changed: boolean;
  decodedSchema: SourceExpression;
  schema: SourceExpression;
}>;
export type CallsProjection = Readonly<{
  changed: boolean;
  decodedCalls: readonly SourceMethodCall[];
  schemaCalls: readonly SourceMethodCall[];
}>;

type RuntimeGuardProjectionContext = Readonly<{
  projectCalls: (calls: readonly ZodMethodCall[]) => Result<CallsProjection>;
  projectExpression: (expression: ZodExpression) => Result<ExpressionProjection>;
}>;

export const appendProjectedCalls = (
  expression: SourceExpression,
  calls: readonly SourceMethodCall[],
): SourceExpression => ({ ...expression, calls: [...expression.calls, ...calls] });

export const projectZodRuntimeGuardExpression = (
  expression: Extract<ZodExpression, { kind: "runtime-guard" }>,
  context: RuntimeGuardProjectionContext,
): Result<ExpressionProjection> => {
  const structural = context.projectExpression(expression.expression);
  if (!structural.ok) return structural;
  const calls = context.projectCalls(expression.calls);
  if (!calls.ok) return calls;
  const changed = structural.value.changed || calls.value.changed;

  return ok({
    changed,
    decodedSchema: appendProjectedCalls(structural.value.decodedSchema, calls.value.decodedCalls),
    schema: sourceRuntimeGuardExpression({
      calls: calls.value.schemaCalls,
      expression: structural.value.schema,
      parseStructural: changed,
      program: expression.program,
    }),
  });
};

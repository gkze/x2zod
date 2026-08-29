import { createDiagnostic } from "./diagnostics";
import { err, ok } from "./result";
import type { Result } from "./result";
import { sourceWrapperExpression } from "./source-model";
import type { SourceExpression, SourceMethodCall } from "./source-model";
import type { ZodExpression } from "./zod-plan";

type ExpressionProjection = Readonly<{
  changed: boolean;
  decodedSchema: SourceExpression;
  schema: SourceExpression;
}>;
type CallsProjection = Readonly<{
  changed: boolean;
  decodedCalls: readonly SourceMethodCall[];
  schemaCalls: readonly SourceMethodCall[];
}>;

const unsupportedWrapperTransform = (wrapper: string): Result<never> =>
  err(
    createDiagnostic({
      code: "unsupported_emission_transform",
      message: `Property-key transforms cannot yet preserve bidirectional wrapper ${wrapper} composition.`,
    }),
  );

export const projectZodWrapperExpression = (
  expression: Extract<ZodExpression, { kind: "wrapper" }>,
  wrapped: ExpressionProjection,
  calls: CallsProjection,
): Result<ExpressionProjection> => {
  if (wrapped.changed || calls.changed) return unsupportedWrapperTransform(expression.wrapper);

  return ok({
    changed: false,
    decodedSchema: sourceWrapperExpression({
      calls: calls.decodedCalls,
      expression: wrapped.decodedSchema,
      requiredOwnKeys: expression.requiredOwnKeys,
      wrapper: expression.wrapper,
    }),
    schema: sourceWrapperExpression({
      calls: calls.schemaCalls,
      expression: wrapped.schema,
      requiredOwnKeys: expression.requiredOwnKeys,
      wrapper: expression.wrapper,
    }),
  });
};

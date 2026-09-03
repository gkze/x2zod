import type { CallsProjection, ExpressionProjection } from "./emission-runtime-transforms";
import { ok } from "./result";
import type { Result } from "./result";
import { sourceWrapperExpression } from "./source-model";
import type { SourceExpression, SourceMethodCall } from "./source-model";
import { sourceCodec } from "./source-projection-builders";
import type { ZodExpression } from "./zod-plan";

const wrappedSourceExpression = (input: {
  readonly calls?: readonly SourceMethodCall[] | undefined;
  readonly expression: Extract<ZodExpression, { kind: "wrapper" }>;
  readonly requiredOwnKeys: readonly string[];
  readonly source: SourceExpression;
}): SourceExpression =>
  sourceWrapperExpression({
    calls: input.calls ?? [],
    expression: input.source,
    requiredOwnKeys: input.requiredOwnKeys,
    wrapper: input.expression.wrapper,
  });

export const projectZodWrapperExpression = (
  expression: Extract<ZodExpression, { kind: "wrapper" }>,
  wrapped: ExpressionProjection,
  projection: Readonly<{ calls: CallsProjection; decodedRequiredOwnKeys: readonly string[] }>,
): Result<ExpressionProjection> => {
  const { calls, decodedRequiredOwnKeys } = projection;
  const decodedSchema = wrappedSourceExpression({
    calls: calls.decodedCalls,
    expression,
    requiredOwnKeys: decodedRequiredOwnKeys,
    source: wrapped.decodedSchema,
  });
  if (!wrapped.changed && !calls.changed)
    return ok({
      changed: false,
      decodedSchema,
      schema: wrappedSourceExpression({
        expression,
        source: wrapped.schema,
        requiredOwnKeys: expression.requiredOwnKeys,
        calls: calls.schemaCalls,
      }),
    });

  const schema =
    wrapped.schema.kind === "codec"
      ? sourceCodec({
          calls: [...wrapped.schema.calls, ...calls.schemaCalls],
          input: wrappedSourceExpression({
            expression,
            source: wrapped.schema.input,
            requiredOwnKeys: expression.requiredOwnKeys,
          }),
          operation: wrapped.schema.operation,
          output: wrappedSourceExpression({
            expression,
            source: wrapped.schema.output,
            requiredOwnKeys: decodedRequiredOwnKeys,
          }),
        })
      : sourceCodec({
          calls: calls.schemaCalls,
          input: wrappedSourceExpression({
            expression,
            source: wrapped.schema,
            requiredOwnKeys: expression.requiredOwnKeys,
          }),
          operation: { kind: "identity" },
          output: wrappedSourceExpression({
            expression,
            source: wrapped.decodedSchema,
            requiredOwnKeys: decodedRequiredOwnKeys,
          }),
        });

  return ok({ changed: true, decodedSchema, schema });
};

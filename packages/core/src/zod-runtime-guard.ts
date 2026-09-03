import type { ZodRuntimeProgramId } from "./runtime-program";
import type {
  ZodExpression,
  ZodExpressionInput,
  ZodMethodCall,
  ZodMethodCallInput,
} from "./zod-plan";

export type ZodRuntimeGuardPlacement = "encoded-input";
export type ZodRuntimeGuardExpression = Readonly<{
  calls: readonly ZodMethodCall[];
  expression: ZodExpression;
  kind: "runtime-guard";
  placement: ZodRuntimeGuardPlacement;
  program: ZodRuntimeProgramId;
}>;
export type ZodRuntimeGuardExpressionInput = Readonly<{
  calls?: readonly ZodMethodCallInput[] | undefined;
  expression: ZodExpressionInput;
  kind: "runtime-guard";
  placement: ZodRuntimeGuardPlacement;
  program: string;
}>;

export const zodRuntimeGuard = (
  expression: ZodExpression,
  program: ZodRuntimeProgramId,
  placement: ZodRuntimeGuardPlacement,
): ZodRuntimeGuardExpression => ({
  calls: [],
  expression,
  kind: "runtime-guard",
  placement,
  program,
});

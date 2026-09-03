import type { Expression, Node } from "@typescript/native-preview/unstable/ast";
import { isExpression } from "@typescript/native-preview/unstable/ast";
import { z } from "zod/v4";

const nonEmptyStringLength = 1;

export type ZodRuntimeProgramId = string;
export type ZodRuntimeProgram = Readonly<{
  expression: Expression;
  id: ZodRuntimeProgramId;
  kind: "predicate";
}>;
export type ZodRuntimeProgramInput = Readonly<{
  expression: Expression;
  id: string;
  kind?: "predicate" | undefined;
}>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  "end" in value &&
  typeof value.end === "number" &&
  "flags" in value &&
  typeof value.flags === "number" &&
  "forEachChild" in value &&
  typeof value.forEachChild === "function" &&
  "getSourceFile" in value &&
  typeof value.getSourceFile === "function" &&
  "kind" in value &&
  typeof value.kind === "number" &&
  "pos" in value &&
  typeof value.pos === "number";

const isRuntimeProgramExpression = (value: unknown): value is Expression =>
  isNode(value) && isExpression(value);

const zodRuntimeProgramIdSchemaValue: z.ZodType<ZodRuntimeProgramId, string> = z
  .string()
  .min(nonEmptyStringLength);
export const zodRuntimeProgramIdSchema: z.ZodType<ZodRuntimeProgramId, string> =
  zodRuntimeProgramIdSchemaValue;

const runtimeProgramExpressionSchema = z.custom<Expression>(isRuntimeProgramExpression, {
  error: "Runtime program expression must be a TypeScript expression AST node.",
});

const zodRuntimeProgramSchemaValue: z.ZodType<ZodRuntimeProgram, ZodRuntimeProgramInput> = z
  .strictObject({
    expression: runtimeProgramExpressionSchema,
    id: zodRuntimeProgramIdSchemaValue,
    kind: z.literal("predicate").default("predicate"),
  })
  .readonly();
export const zodRuntimeProgramSchema: z.ZodType<ZodRuntimeProgram, ZodRuntimeProgramInput> =
  zodRuntimeProgramSchemaValue;

export const zodRuntimeProgram = (id: string, expression: Expression): ZodRuntimeProgram =>
  zodRuntimeProgramSchemaValue.parse({ expression, id });

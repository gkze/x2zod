import type {
  ZodArrayArgument,
  ZodExpressionArgument,
  ZodHelperArgument,
  ZodLiteralArgument,
  ZodObjectShapeArgument,
} from "./zod-plan";

export type ZodFactoryArgumentsByName = Readonly<{
  array: readonly [ZodExpressionArgument];
  boolean: readonly [];
  enum: readonly [ZodArrayArgument<ZodLiteralArgument<string>>];
  literal: readonly [ZodLiteralArgument];
  never: readonly [];
  null: readonly [];
  number: readonly [];
  object: readonly [ZodObjectShapeArgument];
  intersection: readonly [ZodExpressionArgument, ZodExpressionArgument];
  record: readonly [ZodExpressionArgument, ZodExpressionArgument];
  string: readonly [];
  tuple: readonly [ZodArrayArgument<ZodExpressionArgument>];
  union: readonly [ZodArrayArgument<ZodExpressionArgument>];
  unknown: readonly [];
  xor: readonly [ZodArrayArgument<ZodExpressionArgument>];
}>;

export type ZodMethodArgumentsByName = Readonly<{
  catchall: readonly [ZodExpressionArgument];
  gt: readonly [ZodLiteralArgument<number>];
  gte: readonly [ZodLiteralArgument<number>];
  int: readonly [];
  lt: readonly [ZodLiteralArgument<number>];
  lte: readonly [ZodLiteralArgument<number>];
  max: readonly [ZodLiteralArgument<number>];
  min: readonly [ZodLiteralArgument<number>];
  nullable: readonly [];
  optional: readonly [];
  passthrough: readonly [];
  refine: readonly [ZodHelperArgument];
  regex:
    | readonly [pattern: ZodLiteralArgument<string>]
    | readonly [pattern: ZodLiteralArgument<string>, flags: ZodLiteralArgument<string>];
  required: readonly [ZodArrayArgument<ZodLiteralArgument<string>>];
  strict: readonly [];
}>;

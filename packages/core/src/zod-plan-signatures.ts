import type {
  ZodArgument,
  ZodArrayArgument,
  ZodExpressionArgument,
  ZodHelperArgument,
  ZodLiteralArgument,
  ZodObjectShapeArgument,
} from "./zod-plan";
import type {
  ZodArgumentMetadata,
  ZodFactoryArgumentMetadata,
  ZodFactoryName,
  ZodKnownMethodName,
  ZodMethodArgumentMetadata,
} from "./zod-plan-metadata";

interface ArgumentByKind {
  array: ZodArrayArgument;
  expression: ZodExpressionArgument;
  helper: ZodHelperArgument;
  literal: ZodLiteralArgument;
  object: ZodObjectShapeArgument;
}
type ArgumentSequence<TKinds extends readonly ZodArgument["kind"][]> = {
  readonly [TIndex in keyof TKinds]: ArgumentByKind[TKinds[TIndex]];
};
type ArgumentsFor<TMetadata extends ZodArgumentMetadata> =
  TMetadata extends Readonly<{ kind: "none" }>
    ? readonly []
    : TMetadata extends Readonly<{
          kind: "single";
          argumentKind: infer TKind extends ZodArgument["kind"];
        }>
      ? readonly [ArgumentByKind[TKind]]
      : TMetadata extends Readonly<{ kind: "literal"; valueType: infer TValueType }>
        ? readonly [ZodLiteralArgument<TValueType extends "number" ? number : string>]
        : TMetadata extends Readonly<{ kind: "regex" }>
          ?
              | readonly [pattern: ZodLiteralArgument<string>]
              | readonly [pattern: ZodLiteralArgument<string>, flags: ZodLiteralArgument<string>]
          : TMetadata extends Readonly<{
                kind: "sequence";
                argumentKinds: infer TKinds extends readonly ZodArgument["kind"][];
              }>
            ? ArgumentSequence<TKinds>
            : TMetadata extends Readonly<{ kind: "array"; elementKind: infer TElementKind }>
              ? readonly [
                  ZodArrayArgument<
                    TElementKind extends "expression"
                      ? ZodExpressionArgument
                      : ZodLiteralArgument<string>
                  >,
                ]
              : never;

export type ZodFactoryArgumentsByName = {
  readonly [TName in ZodFactoryName]: ArgumentsFor<ZodFactoryArgumentMetadata<TName>>;
};
export type ZodMethodArgumentsByName = {
  readonly [TName in ZodKnownMethodName]: ArgumentsFor<ZodMethodArgumentMetadata<TName>>;
};

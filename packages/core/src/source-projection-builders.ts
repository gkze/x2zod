import type {
  SourceArgument,
  SourceCodecExpression,
  SourceCodecOperation,
  SourceExpression,
  SourceFactoryExpression,
  SourceMethodCall,
  SourceReferenceExpression,
} from "./source-model";
import type { ZodSymbol } from "./zod-plan";
import type { ZodFactoryName } from "./zod-plan-metadata";

type SourceCodecInput = Readonly<{
  calls?: readonly SourceMethodCall[] | undefined;
  input: SourceExpression;
  operation: SourceCodecOperation;
  output: SourceExpression;
}>;

export const sourceFactory = (
  factory: ZodFactoryName,
  args: readonly SourceArgument[],
  calls: readonly SourceMethodCall[],
): SourceFactoryExpression => ({ args, calls, factory, kind: "factory" });

export const sourceReference = (
  symbol: ZodSymbol,
  view: SourceReferenceExpression["view"],
  calls: readonly SourceMethodCall[],
): SourceReferenceExpression => ({ calls, kind: "reference", symbol, view });

export const sourceCodec = ({
  calls = [],
  input,
  operation,
  output,
}: SourceCodecInput): SourceCodecExpression => ({ calls, input, kind: "codec", operation, output });

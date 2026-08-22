import type {
  X2ZodLoadedOutputProcessorRegistry,
  X2ZodOutputProcessorContext,
  X2ZodResolvedOutputConfig,
} from "./types";

export type ApplyX2ZodOutputProcessorsRequest = Readonly<{
  context: X2ZodOutputProcessorContext;
  output: Readonly<{
    processors?: X2ZodResolvedOutputConfig<X2ZodLoadedOutputProcessorRegistry>["processors"];
  }>;
  sourceText: string;
}>;

export const applyX2ZodOutputProcessors = async ({
  context,
  output,
  sourceText,
}: ApplyX2ZodOutputProcessorsRequest): Promise<string> => {
  if (output.processors === undefined) return sourceText;
  let transformed = sourceText;
  for (const step of output.processors)
    transformed = await step.plugin.transform(transformed, step.options as never, context);
  return transformed;
};

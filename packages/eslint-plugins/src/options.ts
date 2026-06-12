import { z } from "zod/v4";

export type OptionsRecord = Readonly<Record<string, unknown>>;

export const optionsRecordSchema: z.ZodType<OptionsRecord> = z
  .record(z.string(), z.unknown())
  .readonly();

export const parseOptionsRecord = (value: unknown): OptionsRecord => {
  const parsed = optionsRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

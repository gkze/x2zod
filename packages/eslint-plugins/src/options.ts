export type OptionsRecord = Readonly<Record<string, unknown>>;

export const isOptionsRecord = (value: unknown): value is OptionsRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

import { z } from "zod/v4";

export const zodWrapperNames = ["preserveObjectInput"] as const;
export const zodHelperNames = [
  "codePointLength",
  "exactMultipleOf",
  "uniqueItems",
  "preserveObjectInput",
] as const;

export type ZodHelperName = (typeof zodHelperNames)[number];
export type ZodWrapperName = (typeof zodWrapperNames)[number];
export type ZodExactMultipleOfHelperRequest = Readonly<{
  helper: "exactMultipleOf";
  divisor: number;
}>;
export type ZodCodePointLengthHelperRequest = Readonly<{
  helper: "codePointLength";
  maximum: number | null;
  minimum: number | null;
}>;
export type ZodUniqueItemsHelperRequest = Readonly<{ helper: "uniqueItems" }>;
export type ZodHelperRequest =
  | ZodCodePointLengthHelperRequest
  | ZodExactMultipleOfHelperRequest
  | ZodUniqueItemsHelperRequest;
export type ZodHelperRequestInput = ZodHelperRequest;
export type ZodHelperReceiver = "array" | "number" | "string";

const lengthSchema = z.number().nonnegative().refine(Number.isInteger).nullable();
const zodCodePointLengthHelperRequestSchema = z
  .strictObject({
    helper: z.literal("codePointLength"),
    maximum: lengthSchema,
    minimum: lengthSchema,
  })
  .readonly()
  .superRefine((request, context) => {
    if (request.minimum === null && request.maximum === null)
      context.addIssue({
        code: "custom",
        message: "Code-point length requires at least one bound.",
      });
    if (request.minimum !== null && request.maximum !== null && request.minimum > request.maximum)
      context.addIssue({
        code: "custom",
        message: "Code-point length minimum cannot exceed its maximum.",
      });
  });
const zodExactMultipleOfHelperRequestSchema = z
  .strictObject({ helper: z.literal("exactMultipleOf"), divisor: z.number().positive() })
  .readonly();
const zodUniqueItemsHelperRequestSchema = z
  .strictObject({ helper: z.literal("uniqueItems") })
  .readonly();
const zodHelperRequestSchemaValue: z.ZodType<ZodHelperRequest, ZodHelperRequestInput> =
  z.discriminatedUnion("helper", [
    zodCodePointLengthHelperRequestSchema,
    zodExactMultipleOfHelperRequestSchema,
    zodUniqueItemsHelperRequestSchema,
  ]);
export const zodHelperRequestSchema: z.ZodType<ZodHelperRequest, ZodHelperRequestInput> =
  zodHelperRequestSchemaValue;

export const zodHelper = {
  codePointLength: (
    minimum: number | null,
    maximum: number | null,
  ): ZodCodePointLengthHelperRequest => ({ helper: "codePointLength", maximum, minimum }),
  exactMultipleOf: (divisor: number): ZodExactMultipleOfHelperRequest => ({
    divisor,
    helper: "exactMultipleOf",
  }),
  uniqueItems: (): ZodUniqueItemsHelperRequest => ({ helper: "uniqueItems" }),
} as const;

const zodHelperReceivers: Readonly<Record<ZodHelperRequest["helper"], ZodHelperReceiver>> = {
  codePointLength: "string",
  exactMultipleOf: "number",
  uniqueItems: "array",
};

export const zodHelperReceiver = (request: ZodHelperRequest): ZodHelperReceiver =>
  zodHelperReceivers[request.helper];

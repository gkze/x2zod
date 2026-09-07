// Generated from the core helper AST builders. Run the runtime package gen script.
import { z } from "zod/v4";
const x2zodCodePointLength = (minimum: number | null, maximum: number | null) => (value: string): boolean => {
    const length = Array.from(value).length;
    return (minimum === null || length >= minimum) && (maximum === null || length <= maximum);
};
const x2zodDecimalParts = (value: number): readonly [
    bigint,
    number
] => {
    const [coefficientText = "0", exponentText = "0"] = value.toString().split("e");
    const [whole = "0", fraction = ""] = coefficientText.split(".");
    return [BigInt(whole + fraction), fraction.length - Number(exponentText)];
};
const x2zodExactMultipleOf = (divisor: number) => (value: number): boolean => {
    const [valueCoefficient, valueScale] = x2zodDecimalParts(value);
    const [divisorCoefficient, divisorScale] = x2zodDecimalParts(divisor);
    const scaleDelta = divisorScale - valueScale;
    return scaleDelta >= 0 ? valueCoefficient * 10n ** BigInt(scaleDelta) % divisorCoefficient === 0n : valueCoefficient % (divisorCoefficient * 10n ** BigInt(-scaleDelta)) === 0n;
};
const x2zodJsonEqual = (left: unknown, right: unknown): boolean => {
    if (left === right)
        return true;
    if (typeof left !== "object" || left === null || (typeof right !== "object" || right === null))
        return false;
    if (Array.isArray(left) || Array.isArray(right))
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => x2zodJsonEqual(value, right[index]));
    const leftRecord = left as globalThis.Record<string, unknown>;
    const rightRecord = right as globalThis.Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(rightRecord, key) && x2zodJsonEqual(leftRecord[key], rightRecord[key]));
};
const x2zodUniqueItems = (values: readonly unknown[]): boolean => values.every((value, index) => values.findIndex(candidate => x2zodJsonEqual(value, candidate)) === index);
const x2zodPreserveObjectInput = <TSchema extends z.ZodType>(schema: TSchema, requiredOwnKeys: readonly string[]): z.ZodCustom<z.input<TSchema>, z.input<TSchema>> => z.custom<z.input<TSchema>>(value => typeof value === "object" && value !== null && !Array.isArray(value) && requiredOwnKeys.every(key => Object.hasOwn(value, key)) && schema.safeParse(Object.assign(Object.create(null), value)).success);
const x2zodPreserveObjectCodec = <TSchema extends z.ZodObject>(schema: TSchema, requiredOwnKeys: readonly string[]): z.ZodCodec<z.ZodCustom<z.input<TSchema>, z.input<TSchema>>, z.ZodCustom<z.output<TSchema>, z.output<TSchema>>> => {
    const transform = (value: globalThis.Record<string, unknown>, payload: z.core.ParsePayload, direction: "decode" | "encode") => {
        const ownValue = Object.assign(Object.create(null), value);
        const parsed = direction === "decode" ? schema.safeDecode(ownValue) : schema.safeEncode(ownValue);
        if (!parsed.success) {
            payload.issues.push({ code: "custom", input: value, message: parsed.error.message });
            return z.NEVER;
        }
        const result = { ...value, ...parsed.data };
        const prototypeSchema = Object.hasOwn(schema.shape, "__proto__") ? schema.shape["__proto__"] : schema.def.catchall;
        if (Object.hasOwn(value, "__proto__") && prototypeSchema !== undefined) {
            const prototypeResult = direction === "decode" ? z.safeDecode(prototypeSchema, value["__proto__"]) : z.safeEncode(prototypeSchema, value["__proto__"]);
            if (!prototypeResult.success) {
                payload.issues.push({ code: "custom", input: value, message: prototypeResult.error.message });
                return z.NEVER;
            }
            Object.defineProperty(result, "__proto__", { value: prototypeResult.data, enumerable: true, configurable: true, writable: true });
        }
        return result;
    };
    const hasOwnKeys = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value) && requiredOwnKeys.every(key => Object.hasOwn(value, key));
    return z.codec(z.custom<z.input<TSchema>>(hasOwnKeys), z.custom<z.output<TSchema>>(hasOwnKeys), { decode: (value, payload) => transform(value, payload, "decode") as z.output<TSchema>, encode: (value, payload) => transform(value, payload, "encode") as z.input<TSchema> });
};
const x2zodApplyRuntimePredicate = <TSchema extends z.ZodType>(_schema: TSchema, predicate: (value: unknown) => boolean): z.ZodCustom<z.infer<TSchema>, z.infer<TSchema>> => z.custom<z.infer<TSchema>>(predicate, "Input does not satisfy the source schema.");
const x2zodApplyEncodedRuntimePredicate = <TInput, TOutput, TSchema extends z.ZodType<TOutput, TInput>>(schema: TSchema, predicate: (value: unknown) => boolean): z.ZodPipe<z.ZodCustom<TInput, TInput>, TSchema> => z.custom<TInput>(predicate, "Input does not satisfy the source schema.").pipe(schema);
const x2zodRemapProperties = <TOutput>(value: globalThis.Record<string, unknown>, mappings: readonly (readonly [
    string,
    string
])[], payload: z.core.ParsePayload): TOutput => {
    const result = { ...value };
    for (const [sourceKey, targetKey] of mappings) {
        if (!Object.hasOwn(value, sourceKey))
            continue;
        if (Object.hasOwn(value, targetKey)) {
            payload.issues.push({
                code: "custom",
                input: value,
                message: "Property-key transform would overwrite an existing key.",
                path: [targetKey]
            });
            return z.NEVER;
        }
        delete result[sourceKey];
        Object.defineProperty(result, targetKey, {
            configurable: true,
            enumerable: true,
            value: value[sourceKey],
            writable: true
        });
    }
    return result as TOutput;
};
export { x2zodCodePointLength, x2zodDecimalParts, x2zodExactMultipleOf, x2zodJsonEqual, x2zodUniqueItems, x2zodPreserveObjectInput, x2zodPreserveObjectCodec, x2zodApplyRuntimePredicate, x2zodApplyEncodedRuntimePredicate, x2zodRemapProperties };

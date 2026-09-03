import { _ } from "ajv/dist/compile/codegen/index.js";
import type AjvCore from "ajv/dist/core.js";
import type { CodeKeywordDefinition } from "ajv/dist/types/index.js";

const multipleOfKeyword = "multipleOf";

const decimalParts = (value: number): readonly [bigint, number] => {
  const [coefficientText = "0", exponentText = "0"] = value.toString().split("e");
  const [whole = "0", fraction = ""] = coefficientText.split(".");
  return [BigInt(whole + fraction), fraction.length - Number(exponentText)];
};

const exactMultipleOf = (value: number, divisor: number): boolean => {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) return false;
  const [valueCoefficient, valueScale] = decimalParts(value);
  const [divisorCoefficient, divisorScale] = decimalParts(divisor);
  const scaleDelta = divisorScale - valueScale;
  return scaleDelta >= 0
    ? (valueCoefficient * 10n ** BigInt(scaleDelta)) % divisorCoefficient === 0n
    : valueCoefficient % (divisorCoefficient * 10n ** BigInt(-scaleDelta)) === 0n;
};

const exactMultipleOfSource = _`(value, divisor) => {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) return false;
  const decimalParts = (input) => {
    const [coefficientText = "0", exponentText = "0"] = input.toString().split("e");
    const [whole = "0", fraction = ""] = coefficientText.split(".");
    return [BigInt(whole + fraction), fraction.length - Number(exponentText)];
  };
  const [valueCoefficient, valueScale] = decimalParts(value);
  const [divisorCoefficient, divisorScale] = decimalParts(divisor);
  const scaleDelta = divisorScale - valueScale;
  return scaleDelta >= 0
    ? (valueCoefficient * 10n ** BigInt(scaleDelta)) % divisorCoefficient === 0n
    : valueCoefficient % (divisorCoefficient * 10n ** BigInt(-scaleDelta)) === 0n;
}`;

const exactMultipleOfDefinition: CodeKeywordDefinition = {
  code: (context): void => {
    const predicate = context.gen.scopeValue("func", {
      code: exactMultipleOfSource,
      key: "x2zodExactMultipleOf",
      ref: exactMultipleOf,
    });
    context.fail(_`!${predicate}(${context.data}, ${context.schemaCode})`);
  },
  keyword: multipleOfKeyword,
  schemaType: "number",
  type: "number",
};

export const installExactMultipleOf = (ajv: AjvCore): void => {
  ajv.removeKeyword(multipleOfKeyword);
  ajv.addKeyword(exactMultipleOfDefinition);
};

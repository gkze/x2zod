export const standaloneRuntimeDependencies = {
  equal: "ajv/dist/runtime/equal",
  ucs2Length: "ajv/dist/runtime/ucs2length",
} as const;

export const standaloneRuntimePreamble: string = String.raw`
const x2zodEqual = (left, right) => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return left !== left && right !== right;
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const length = left.length;
    if (length !== right.length) return false;
    for (let index = length; index-- !== 0;)
      if (!x2zodEqual(left[index], right[index])) return false;
    return true;
  }
  const keys = Object.keys(left);
  const length = keys.length;
  if (length !== Object.keys(right).length) return false;
  for (let index = length; index-- !== 0;)
    if (!Object.prototype.hasOwnProperty.call(right, keys[index])) return false;
  for (let index = length; index-- !== 0;)
    if (!x2zodEqual(left[keys[index]], right[keys[index]])) return false;
  return true;
};

const x2zodUcs2Length = (value) => {
  const codeUnitLength = value.length;
  let length = 0;
  let position = 0;
  let codeUnit;
  while (position < codeUnitLength) {
    length += 1;
    codeUnit = value.charCodeAt(position);
    position += 1;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && position < codeUnitLength) {
      codeUnit = value.charCodeAt(position);
      if ((codeUnit & 0xfc00) === 0xdc00) position += 1;
    }
  }
  return length;
};

const require = (specifier) => {
  if (specifier === ${JSON.stringify(standaloneRuntimeDependencies.equal)}) return { default: x2zodEqual };
  if (specifier === ${JSON.stringify(standaloneRuntimeDependencies.ucs2Length)}) return { default: x2zodUcs2Length };
  throw new Error("Unsupported generated JSON Schema runtime dependency: " + specifier);
};
`;

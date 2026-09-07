export const isRuntimeJsonObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object";

export const x2zodEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!isRuntimeJsonObject(left) || !isRuntimeJsonObject(right))
    return Number.isNaN(left) && Number.isNaN(right);
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1)
      if (!x2zodEqual(left[index], right[index])) return false;
    return true;
  }
  if (Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && x2zodEqual(left[key], right[key]))
  );
};

export const x2zodUcs2Length = (value: string): number => {
  const maximumCodeUnit = 65_535;
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const point = value.codePointAt(index);
    if (point !== undefined && point > maximumCodeUnit) index += 1;
    length += 1;
  }
  return length;
};

export const standaloneRuntimeDependencies = {
  equal: "ajv/dist/runtime/equal",
  ucs2Length: "ajv/dist/runtime/ucs2length",
} as const;

export const x2zodRequire = (
  specifier: string,
): Readonly<{ default: typeof x2zodEqual | typeof x2zodUcs2Length }> => {
  if (specifier === standaloneRuntimeDependencies.equal) return { default: x2zodEqual };
  if (specifier === standaloneRuntimeDependencies.ucs2Length) return { default: x2zodUcs2Length };
  throw new Error(`Unsupported generated JSON Schema runtime dependency: ${specifier}`);
};

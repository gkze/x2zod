export type RuntimeDescriptor = Readonly<{
  additionalItems?: number | undefined;
  additionalProperties?:
    | Readonly<{ names: readonly string[]; patterns: readonly string[]; schema: number }>
    | undefined;
  allOf?: readonly number[] | undefined;
  anyOf?: readonly number[] | undefined;
  contains?: Readonly<{ maximum: number | null; minimum: number; schema: number }> | undefined;
  dependentSchemas?: Readonly<Record<string, number>> | undefined;
  dynamicRef?: Readonly<{ anchor: string; dynamic: boolean; target: number }> | undefined;
  elseSchema?: number | undefined;
  ifSchema?: number | undefined;
  items?: Readonly<{ from: number; schema: number }> | undefined;
  notSchema?: number | undefined;
  oneOf?: readonly number[] | undefined;
  patternProperties?: readonly (readonly [string, number])[] | undefined;
  prefixItems?: readonly number[] | undefined;
  propertyNames?: number | undefined;
  properties?: Readonly<Record<string, number>> | undefined;
  recursiveRef?: Readonly<{ dynamic: boolean; target: number }> | undefined;
  ref?: number | undefined;
  resource: number;
  thenSchema?: number | undefined;
  unevaluatedItems?: number | undefined;
  unevaluatedProperties?: number | undefined;
  validator: number;
}>;

export type RuntimeResource = Readonly<{
  dynamicAnchors: readonly (readonly [string, number])[];
  recursiveAnchor?: number | undefined;
}>;

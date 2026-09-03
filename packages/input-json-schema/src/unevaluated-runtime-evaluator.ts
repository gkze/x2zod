import type {
  RuntimeDescriptor,
  RuntimeDescriptorGraph,
  RuntimeResource,
} from "./unevaluated-runtime-descriptors";

export type RuntimeNodeValidator = (value: unknown) => boolean;
interface RuntimeEvaluation {
  items: Set<number>;
  properties: Set<string>;
  valid: boolean;
}
type RuntimeEvaluationContext = Readonly<{
  active: Map<unknown, Set<string>>;
  nodes: readonly RuntimeDescriptor[];
  patterns: Map<string, RegExp>;
  resources: readonly RuntimeResource[];
  validators: readonly RuntimeNodeValidator[];
}>;
type RuntimeNodeEvaluator = (index: number, input: unknown) => RuntimeEvaluation;
type RuntimeNodeEvaluationRequest = Readonly<{
  current: RuntimeEvaluation;
  evaluate: RuntimeNodeEvaluator;
  input: unknown;
  node: RuntimeDescriptor;
  testPattern: (pattern: string, value: string) => boolean;
}>;
type RuntimeObjectEvaluationRequest = Omit<RuntimeNodeEvaluationRequest, "input"> &
  Readonly<{ input: Readonly<Record<string, unknown>>; keys: readonly string[] }>;
type SameInstanceMode = "all" | "any" | "one";
type RuntimeEvaluationStep = Readonly<{
  context: RuntimeEvaluationContext;
  index: number;
  input: unknown;
  scope: readonly number[];
}>;
type RuntimeEvaluationMachine = Omit<RuntimeEvaluationContext, "active"> &
  Readonly<{ root: number }>;

const x2zodRuntimeValueAt = <TValue>(values: readonly TValue[], index: number): TValue => {
  const value = values[index];
  if (value === undefined) throw new Error("Invalid JSON Schema runtime descriptor index.");
  return value;
};

const x2zodIsRuntimeObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const x2zodTestRuntimePattern = (
  patterns: Map<string, RegExp>,
  pattern: string,
  value: string,
): boolean => {
  let compiled = patterns.get(pattern);
  if (compiled === undefined) {
    compiled = new RegExp(pattern, "u");
    patterns.set(pattern, compiled);
  }
  return compiled.test(value);
};

const x2zodEvaluationResult = (valid: boolean): RuntimeEvaluation => ({
  items: new Set(),
  properties: new Set(),
  valid,
});

const x2zodMergeEvaluation = (target: RuntimeEvaluation, source: RuntimeEvaluation): void => {
  for (const item of source.items) target.items.add(item);
  for (const property of source.properties) target.properties.add(property);
};

const x2zodScopedDynamicTarget = (
  resources: readonly RuntimeResource[],
  scope: readonly number[],
  anchor: string,
): number | undefined => {
  for (const resourceIndex of scope) {
    const resource = x2zodRuntimeValueAt(resources, resourceIndex);
    const entry = resource.dynamicAnchors.find(([name]) => name === anchor);
    if (entry !== undefined) return entry[1];
  }
  return undefined;
};

const x2zodScopedRecursiveTarget = (
  resources: readonly RuntimeResource[],
  scope: readonly number[],
): number | undefined => {
  for (const resourceIndex of scope) {
    const target = x2zodRuntimeValueAt(resources, resourceIndex).recursiveAnchor;
    if (target !== undefined) return target;
  }
  return undefined;
};

const x2zodEvaluateSameInstance = (
  request: RuntimeNodeEvaluationRequest,
  children: readonly number[] | undefined,
  mode: SameInstanceMode,
): void => {
  if (children === undefined) return;
  const matches = children.map((child) => request.evaluate(child, request.input));
  const validMatches = matches.filter((match) => match.valid);
  if (mode === "all") request.current.valid &&= validMatches.length === matches.length;
  else if (mode === "any") request.current.valid &&= validMatches.length > 0;
  else request.current.valid &&= validMatches.length === 1;
  for (const match of validMatches) x2zodMergeEvaluation(request.current, match);
};

const x2zodEvaluateReference = (request: RuntimeNodeEvaluationRequest, target: number): void => {
  const referenced = request.evaluate(target, request.input);
  request.current.valid &&= referenced.valid;
  if (referenced.valid) x2zodMergeEvaluation(request.current, referenced);
};

const x2zodEvaluateConditional = (request: RuntimeNodeEvaluationRequest): void => {
  if (request.node.notSchema !== undefined)
    request.current.valid &&= !request.evaluate(request.node.notSchema, request.input).valid;
  if (request.node.ifSchema === undefined) return;
  const condition = request.evaluate(request.node.ifSchema, request.input);
  if (condition.valid) {
    x2zodMergeEvaluation(request.current, condition);
    if (request.node.thenSchema !== undefined) {
      const selected = request.evaluate(request.node.thenSchema, request.input);
      request.current.valid &&= selected.valid;
      if (selected.valid) x2zodMergeEvaluation(request.current, selected);
    }
  } else if (request.node.elseSchema !== undefined) {
    const selected = request.evaluate(request.node.elseSchema, request.input);
    request.current.valid &&= selected.valid;
    if (selected.valid) x2zodMergeEvaluation(request.current, selected);
  }
};

type RuntimeArrayEvaluationRequest = RuntimeNodeEvaluationRequest &
  Readonly<{ input: readonly unknown[] }>;

const x2zodEvaluatePrefixItems = (request: RuntimeArrayEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.prefixItems !== undefined)
    for (let item = 0; item < node.prefixItems.length && item < input.length; item += 1) {
      current.valid &&= evaluate(x2zodRuntimeValueAt(node.prefixItems, item), input[item]).valid;
      current.items.add(item);
    }
};

const x2zodEvaluateItems = (request: RuntimeArrayEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.items !== undefined)
    for (let item = node.items.from; item < input.length; item += 1) {
      current.valid &&= evaluate(node.items.schema, input[item]).valid;
      current.items.add(item);
    }
};

const x2zodEvaluateAdditionalItems = (request: RuntimeArrayEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.additionalItems !== undefined)
    for (let item = node.prefixItems?.length ?? 0; item < input.length; item += 1) {
      current.valid &&= evaluate(node.additionalItems, input[item]).valid;
      current.items.add(item);
    }
};

const x2zodEvaluateContains = (request: RuntimeArrayEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.contains !== undefined) {
    let matches = 0;
    for (let item = 0; item < input.length; item += 1)
      if (evaluate(node.contains.schema, input[item]).valid) {
        matches += 1;
        current.items.add(item);
      }
    current.valid &&=
      matches >= node.contains.minimum &&
      (node.contains.maximum === null || matches <= node.contains.maximum);
  }
};

const x2zodEvaluateUnevaluatedItems = (request: RuntimeArrayEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.unevaluatedItems !== undefined)
    for (let item = 0; item < input.length; item += 1)
      if (!current.items.has(item)) {
        current.valid &&= evaluate(node.unevaluatedItems, input[item]).valid;
        current.items.add(item);
      }
};

const x2zodEvaluateArray = (request: RuntimeArrayEvaluationRequest): void => {
  x2zodEvaluatePrefixItems(request);
  x2zodEvaluateItems(request);
  x2zodEvaluateAdditionalItems(request);
  x2zodEvaluateContains(request);
  x2zodEvaluateUnevaluatedItems(request);
};

const x2zodEvaluatePropertyNames = (request: RuntimeObjectEvaluationRequest): void => {
  const { current, evaluate, keys, node } = request;
  if (node.propertyNames !== undefined)
    for (const property of keys) current.valid &&= evaluate(node.propertyNames, property).valid;
};

const x2zodEvaluateProperties = (request: RuntimeObjectEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.properties !== undefined)
    for (const [property, schema] of Object.entries(node.properties))
      if (Object.hasOwn(input, property)) {
        current.valid &&= evaluate(schema, input[property]).valid;
        current.properties.add(property);
      }
};

const x2zodEvaluatePatternProperties = (request: RuntimeObjectEvaluationRequest): void => {
  const { current, evaluate, input, keys, node, testPattern } = request;
  if (node.patternProperties !== undefined)
    for (const [pattern, schema] of node.patternProperties)
      for (const property of keys)
        if (testPattern(pattern, property)) {
          current.valid &&= evaluate(schema, input[property]).valid;
          current.properties.add(property);
        }
};

const x2zodEvaluateAdditionalProperties = (request: RuntimeObjectEvaluationRequest): void => {
  const { current, evaluate, input, keys, node, testPattern } = request;
  if (node.additionalProperties !== undefined)
    for (const property of keys)
      if (
        !node.additionalProperties.names.includes(property) &&
        !node.additionalProperties.patterns.some((pattern) => testPattern(pattern, property))
      ) {
        current.valid &&= evaluate(node.additionalProperties.schema, input[property]).valid;
        current.properties.add(property);
      }
};

const x2zodEvaluateDependentSchemas = (request: RuntimeObjectEvaluationRequest): void => {
  const { current, evaluate, input, node } = request;
  if (node.dependentSchemas !== undefined)
    for (const [property, schema] of Object.entries(node.dependentSchemas))
      if (Object.hasOwn(input, property)) {
        const dependent = evaluate(schema, input);
        current.valid &&= dependent.valid;
        if (dependent.valid) x2zodMergeEvaluation(current, dependent);
      }
};

const x2zodEvaluateUnevaluatedProperties = (request: RuntimeObjectEvaluationRequest): void => {
  const { current, evaluate, input, keys, node } = request;
  if (node.unevaluatedProperties !== undefined)
    for (const property of keys)
      if (!current.properties.has(property)) {
        current.valid &&= evaluate(node.unevaluatedProperties, input[property]).valid;
        current.properties.add(property);
      }
};

const x2zodEvaluateObject = (request: RuntimeObjectEvaluationRequest): void => {
  x2zodEvaluatePropertyNames(request);
  x2zodEvaluateProperties(request);
  x2zodEvaluatePatternProperties(request);
  x2zodEvaluateAdditionalProperties(request);
  x2zodEvaluateDependentSchemas(request);
  x2zodEvaluateUnevaluatedProperties(request);
};

const x2zodEvaluateRuntimeNode = ({
  context,
  index,
  input,
  scope,
}: RuntimeEvaluationStep): RuntimeEvaluation => {
  const node = x2zodRuntimeValueAt(context.nodes, index);
  const validator = x2zodRuntimeValueAt(context.validators, node.validator);
  const lastScopeIndex = -1;
  const currentScope =
    scope.at(lastScopeIndex) === node.resource ? scope : [...scope, node.resource];
  const marker = `${index.toString()}:${[...new Set(currentScope)].join(",")}`;
  const activeMarkers = context.active.get(input) ?? new Set<string>();
  if (activeMarkers.has(marker)) return x2zodEvaluationResult(true);
  activeMarkers.add(marker);
  context.active.set(input, activeMarkers);
  try {
    const current = x2zodEvaluationResult(validator(input));
    if (!current.valid) return current;
    const evaluate: RuntimeNodeEvaluator = (child, value) =>
      x2zodEvaluateRuntimeNode({ context, index: child, input: value, scope: currentScope });
    const testPattern = (pattern: string, value: string): boolean =>
      x2zodTestRuntimePattern(context.patterns, pattern, value);
    const request: RuntimeNodeEvaluationRequest = { current, evaluate, input, node, testPattern };
    x2zodEvaluateSameInstance(request, node.allOf, "all");
    x2zodEvaluateSameInstance(request, node.anyOf, "any");
    x2zodEvaluateSameInstance(request, node.oneOf, "one");
    if (node.ref !== undefined) x2zodEvaluateReference(request, node.ref);
    if (node.recursiveRef !== undefined)
      x2zodEvaluateReference(
        request,
        node.recursiveRef.dynamic
          ? (x2zodScopedRecursiveTarget(context.resources, currentScope) ??
              node.recursiveRef.target)
          : node.recursiveRef.target,
      );
    if (node.dynamicRef !== undefined)
      x2zodEvaluateReference(
        request,
        node.dynamicRef.dynamic
          ? (x2zodScopedDynamicTarget(context.resources, currentScope, node.dynamicRef.anchor) ??
              node.dynamicRef.target)
          : node.dynamicRef.target,
      );
    x2zodEvaluateConditional(request);
    if (Array.isArray(input)) x2zodEvaluateArray({ ...request, input });
    else if (x2zodIsRuntimeObject(input))
      x2zodEvaluateObject({ ...request, input, keys: Object.keys(input) });
    return current;
  } finally {
    activeMarkers.delete(marker);
    if (activeMarkers.size === 0) context.active.delete(input);
  }
};

const x2zodEvaluateRuntimeDescriptors = (
  machine: RuntimeEvaluationMachine,
  input: unknown,
): boolean =>
  x2zodEvaluateRuntimeNode({
    context: {
      active: new Map(),
      nodes: machine.nodes,
      patterns: machine.patterns,
      resources: machine.resources,
      validators: machine.validators,
    },
    index: machine.root,
    input,
    scope: [],
  }).valid;

export const createRuntimeDescriptorEvaluator = (
  graph: Pick<RuntimeDescriptorGraph, "descriptors" | "resources" | "root">,
  validators: readonly RuntimeNodeValidator[],
): RuntimeNodeValidator => {
  if (validators.length !== graph.descriptors.length)
    throw new Error("JSON Schema runtime descriptors and validators must have equal lengths.");
  const machine: RuntimeEvaluationMachine = {
    nodes: graph.descriptors,
    patterns: new Map(),
    resources: graph.resources,
    root: graph.root,
    validators,
  };
  return (input): boolean => x2zodEvaluateRuntimeDescriptors(machine, input);
};

type RuntimeSourceFunction = Readonly<{ name: string; toString: () => string }>;

const runtimeFunctionDeclaration = (implementation: RuntimeSourceFunction): string =>
  `const ${implementation.name} = ${implementation.toString()};`;

export const runtimeEvaluatorSource: string = [
  ...[
    x2zodRuntimeValueAt,
    x2zodIsRuntimeObject,
    x2zodTestRuntimePattern,
    x2zodEvaluationResult,
    x2zodMergeEvaluation,
    x2zodScopedDynamicTarget,
    x2zodScopedRecursiveTarget,
    x2zodEvaluateSameInstance,
    x2zodEvaluateReference,
    x2zodEvaluateConditional,
    x2zodEvaluatePrefixItems,
    x2zodEvaluateItems,
    x2zodEvaluateAdditionalItems,
    x2zodEvaluateContains,
    x2zodEvaluateUnevaluatedItems,
    x2zodEvaluateArray,
    x2zodEvaluatePropertyNames,
    x2zodEvaluateProperties,
    x2zodEvaluatePatternProperties,
    x2zodEvaluateAdditionalProperties,
    x2zodEvaluateDependentSchemas,
    x2zodEvaluateUnevaluatedProperties,
    x2zodEvaluateObject,
    x2zodEvaluateRuntimeNode,
    x2zodEvaluateRuntimeDescriptors,
  ].map((implementation) => runtimeFunctionDeclaration(implementation)),
  `const x2zodEvaluate = ${x2zodEvaluateRuntimeDescriptors.name};`,
].join("\n");

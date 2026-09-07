import {
  runtimeEvaluatorFunctions,
  x2zodEvaluateRuntimeDescriptors,
} from "./json-schema-evaluator";
import {
  isRuntimeJsonObject,
  standaloneRuntimeDependencies,
  x2zodEqual,
  x2zodRequire,
  x2zodUcs2Length,
} from "./json-schema-primitives";

export { standaloneRuntimeDependencies } from "./json-schema-primitives";

const declaration = (implementation: Readonly<{ name: string; toString: () => string }>): string =>
  `const ${implementation.name} = ${implementation.toString()};`;

export const runtimeEvaluatorSource: string = [
  ...runtimeEvaluatorFunctions.map((implementation) => declaration(implementation)),
  `const x2zodEvaluate = ${x2zodEvaluateRuntimeDescriptors.name};`,
].join("\n");

export const standaloneRuntimePreamble: string = [
  ...[isRuntimeJsonObject, x2zodEqual, x2zodUcs2Length].map((implementation) =>
    declaration(implementation),
  ),
  `const standaloneRuntimeDependencies = ${JSON.stringify(standaloneRuntimeDependencies)};`,
  `const require = ${x2zodRequire.toString()};`,
].join("\n");

import process from "node:process";

import type { SourceFile } from "@typescript/native-preview/ast";
import { API, Emitter } from "@typescript/native-preview/sync";

type NativeEmitterClient = ConstructorParameters<typeof Emitter>[0];

export const diagnosticText = (
  diagnostics: readonly Readonly<{ code: string; message: string }>[],
): string =>
  diagnostics
    .map((diagnostic): string => [diagnostic.code, diagnostic.message].join(": "))
    .join("\n");

export const requiredArgument = (index: number, name: string): string => {
  const value = process.argv[index];
  if (value === undefined) throw new Error(`Missing ${name} argument.`);
  return value;
};

export const optionalArgument = (index: number): string | undefined => process.argv[index];

export const printNativeSourceFile = (sourceFile: SourceFile): string => {
  const api = new API({ cwd: process.cwd() });
  const nativeClient = (api as unknown as Readonly<{ client: NativeEmitterClient }>).client;
  const emitter = new Emitter(nativeClient);

  try {
    return emitter.printNode(sourceFile);
  } finally {
    api.close();
  }
};

export const writeNativeSourceFile = (sourceFile: SourceFile): void => {
  process.stdout.write(printNativeSourceFile(sourceFile));
};

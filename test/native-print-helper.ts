import process from "node:process";

import type { SourceFile } from "@typescript/native-preview/unstable/ast";
import { API, Emitter } from "@typescript/native-preview/unstable/sync";

import { isRecord } from "./structural";

type NativeEmitterClient = ConstructorParameters<typeof Emitter>[0];
type NativeApiHandle = Readonly<{ client: NativeEmitterClient; close: () => void }>;

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

const isNativeApiHandle = (value: unknown): value is NativeApiHandle =>
  isRecord(value) && value["client"] !== undefined && typeof value["close"] === "function";

export const printNativeSourceFile = (sourceFile: SourceFile): string => {
  const api: unknown = new API({ cwd: process.cwd() });
  if (!isNativeApiHandle(api)) throw new Error("Native TypeScript API client is unavailable.");
  const emitter = new Emitter(api.client);

  try {
    return emitter.printNode(sourceFile);
  } finally {
    api.close();
  }
};

export const writeNativeSourceFile = (sourceFile: SourceFile): void => {
  process.stdout.write(printNativeSourceFile(sourceFile));
};

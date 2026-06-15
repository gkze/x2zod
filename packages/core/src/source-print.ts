import type { SourceFile } from "@typescript/native-preview/unstable/ast";
import {
  API as AsyncAPI,
  Emitter as AsyncEmitter,
} from "@typescript/native-preview/unstable/async";
import { API as SyncAPI, Emitter as SyncEmitter } from "@typescript/native-preview/unstable/sync";

type UnknownRecord = Readonly<Record<string, unknown>>;
type AsyncNativeEmitterClient = ConstructorParameters<typeof AsyncEmitter>[0];
type SyncNativeEmitterClient = ConstructorParameters<typeof SyncEmitter>[0];
type AsyncNativeApiHandle = Readonly<{
  client: AsyncNativeEmitterClient;
  close: () => Promise<void>;
}>;
type SyncNativeApiHandle = Readonly<{ client: SyncNativeEmitterClient; close: () => void }>;

export type SourceFilePrintOptions = Readonly<{ cwd: string }>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAsyncNativeApiHandle = (value: unknown): value is AsyncNativeApiHandle =>
  isRecord(value) && value["client"] !== undefined && typeof value["close"] === "function";

const isSyncNativeApiHandle = (value: unknown): value is SyncNativeApiHandle =>
  isRecord(value) && value["client"] !== undefined && typeof value["close"] === "function";

export const printSourceFile = async (
  sourceFile: SourceFile,
  options: SourceFilePrintOptions,
): Promise<string> => {
  const api: unknown = new AsyncAPI({ cwd: options.cwd });
  if (!isAsyncNativeApiHandle(api)) throw new Error("Native TypeScript API client is unavailable.");
  const emitter = new AsyncEmitter(api.client);

  try {
    const sourceText = await emitter.printNode(sourceFile);
    return sourceText;
  } finally {
    await api.close();
  }
};

export const printSourceFileSync = (
  sourceFile: SourceFile,
  options: SourceFilePrintOptions,
): string => {
  const api: unknown = new SyncAPI({ cwd: options.cwd });
  if (!isSyncNativeApiHandle(api)) throw new Error("Native TypeScript API client is unavailable.");
  const emitter = new SyncEmitter(api.client);

  try {
    const sourceText = emitter.printNode(sourceFile);
    return sourceText;
  } finally {
    api.close();
  }
};

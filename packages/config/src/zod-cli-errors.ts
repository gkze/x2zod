export class ZodCLIOptionSchemaError extends Error {
  public readonly path: readonly string[];

  public constructor(path: readonly string[], message: string) {
    super(`${formatPath(path)}: ${message}`);
    this.name = "ZodCLIOptionSchemaError";
    this.path = path;
  }
}

export const formatPath = (path: readonly string[]): string =>
  path.length === 0 ? "<root>" : path.join(".");

export const schemaError = (path: readonly string[], message: string): ZodCLIOptionSchemaError =>
  new ZodCLIOptionSchemaError(path, message);

import type { FileInputDocumentSource, InputDocument, InputDocumentSource } from "@x2zod/core";

export type TextFileSystem = Readonly<{ readTextFile: (filePath: string) => Promise<string> }>;

export type FilePathResolveRequest = Readonly<{ path: string; rootDirectory: string }>;

export type FilePathResolver = Readonly<{
  resolveFilePath: (request: FilePathResolveRequest) => string;
}>;

export type JsonSchemaResourceLoadRequest<
  TSource extends InputDocumentSource = InputDocumentSource,
> = Readonly<{ source: TSource; mediaType?: string }>;

export type JsonSchemaResourceLoader<TSource extends InputDocumentSource = InputDocumentSource> =
  Readonly<{
    loadTextResource: (request: JsonSchemaResourceLoadRequest<TSource>) => Promise<InputDocument>;
  }>;

export type JsonSchemaFileResourceLoader = JsonSchemaResourceLoader<FileInputDocumentSource>;

export type CreateFileSystemResourceLoaderOptions = Readonly<{
  fileSystem: TextFileSystem;
  pathResolver: FilePathResolver;
  rootDirectory: string;
  mediaType?: string;
}>;

const withMediaType = (mediaType: string | undefined): Pick<InputDocument, "mediaType"> =>
  mediaType === undefined ? {} : { mediaType };

export const createFileSystemResourceLoader = ({
  fileSystem,
  pathResolver,
  rootDirectory,
  mediaType: defaultMediaType,
}: CreateFileSystemResourceLoaderOptions): JsonSchemaFileResourceLoader => ({
  loadTextResource: async ({ source, mediaType }): Promise<InputDocument> => {
    const absolutePath = pathResolver.resolveFilePath({ path: source.path, rootDirectory });
    const resolvedMediaType = mediaType ?? defaultMediaType;

    return {
      source: { kind: "file", path: absolutePath },
      text: await fileSystem.readTextFile(absolutePath),
      ...withMediaType(resolvedMediaType),
    };
  },
});

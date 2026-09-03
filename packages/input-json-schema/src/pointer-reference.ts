import type { JsonPointer } from "@x2zod/core";

type JsonSchemaPointerReferenceRequest = Readonly<{
  local: boolean;
  pointer: JsonPointer;
  retrievalUri: string;
  rootPointer: JsonPointer;
}>;

const encodedPointer = (pointer: JsonPointer): string =>
  pointer
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const jsonSchemaPointerReference = ({
  local,
  pointer,
  retrievalUri,
  rootPointer,
}: JsonSchemaPointerReferenceRequest): string => {
  if (pointer === rootPointer) return local ? "#" : retrievalUri;
  const fragment = encodedPointer(pointer);
  return local ? `#${fragment}` : `${retrievalUri}#${fragment}`;
};

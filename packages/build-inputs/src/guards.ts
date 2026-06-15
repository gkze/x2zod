import type {
  ResolvedBuildInput,
  ResolvedBuildInputArchive,
  ResolvedBuildInputFile,
} from "./schemas";

export const isArchiveBuildInput = (
  input: ResolvedBuildInput,
): input is ResolvedBuildInputArchive => input.type === "archive";

export const isFileBuildInput = (input: ResolvedBuildInput): input is ResolvedBuildInputFile =>
  input.type !== "archive";

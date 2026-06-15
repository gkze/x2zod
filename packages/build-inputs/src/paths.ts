import { existsSync } from "node:fs";
import path from "node:path";

export const resolveBuildInputPath = (
  rootDir: string,
  filePath: string,
  mustExist: boolean,
): string => {
  const resolved = path.resolve(rootDir, filePath);
  const relative = path.relative(rootDir, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Build input path escapes root: ${filePath}`);
  if (mustExist && !existsSync(resolved))
    throw new Error(`Build input path does not exist: ${filePath}`);

  return resolved;
};

export const isChildBuildInputPath = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

export const buildInputPathsOverlap = (leftPath: string, rightPath: string): boolean =>
  leftPath === rightPath ||
  isChildBuildInputPath(leftPath, rightPath) ||
  isChildBuildInputPath(rightPath, leftPath);

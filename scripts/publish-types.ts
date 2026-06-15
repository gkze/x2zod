import type { Config, DependencyType } from "@changesets/types";
import type { Package } from "@manypkg/get-packages";

export type PublishContext = Readonly<{
  dryRun: boolean;
  npmAccess: Config["access"];
  npmTag?: string | undefined;
  packageVersions: ReadonlyMap<string, string>;
}>;

export type MaterializedPackage = Readonly<{
  directory: string;
  manifestPath: string;
  tempRoot: string;
}>;

export type RegistryPublisher<TName extends string = string> = Readonly<{
  isPackagePublishable: (workspacePackage: Package) => Promise<boolean> | boolean;
  isVersionPublished: (workspacePackage: Package) => Promise<boolean>;
  name: TName;
  publish: (workspacePackage: Package, context: PublishContext) => Promise<void>;
}>;

export const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const satisfies readonly DependencyType[];

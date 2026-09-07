import { rmSync } from "node:fs";
import path from "node:path";

import {
  buildNodeBundle,
  createTemporaryDirectory,
  isNativePreviewShutdownStderr,
  nativePreviewExternals,
  runNode,
} from "../../../test/native-source-harness";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = createTemporaryDirectory({
  prefix: "runtime-gen-",
  rootDirectory: path.join(root, "node_modules/.cache"),
});
try {
  const outfile = path.join(directory, "generate.mjs");
  buildNodeBundle({
    cwd: root,
    entryPoint: path.join(import.meta.dirname, "runtime-source.ts"),
    externals: [...nativePreviewExternals, "oxfmt/package.json"],
    outfile,
  });
  runNode({
    args: [outfile, ...process.argv.slice(2)],
    cwd: root,
    allowedStderr: isNativePreviewShutdownStderr,
  });
} finally {
  rmSync(directory, { force: true, recursive: true });
}

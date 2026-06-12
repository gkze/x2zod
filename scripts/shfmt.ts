import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import type { RunOptions } from "@optique/run";
import { runSync } from "@optique/run";
import type { FormatOptions } from "@wasm-fmt/shfmt";
import { format } from "@wasm-fmt/shfmt";

const paths = [".envrc"] as const;
type ShellPath = (typeof paths)[number];
type FormattedShellFile = Readonly<{ path: ShellPath; source: string; formatted: string }>;

const options = { indent: 2, simplify: true } satisfies FormatOptions;
const program = defineProgram({
  metadata: { name: "shfmt", brief: message`Format shell files.` },
  parser: object({
    write: option("-w", "--write", {
      description: message`Write formatted shell files instead of checking for drift.`,
    }),
  }),
});
const runOptions = {
  aboveError: "usage",
  help: { option: { names: ["-h", "--help"] } },
} satisfies RunOptions;

const reportChanged = (changedFilePaths: readonly ShellPath[]): void => {
  if (changedFilePaths.length === 0) return;

  process.stderr.write(
    ["shfmt check failed for:", ...changedFilePaths.map((path) => `  ${path}`)].join("\n"),
  );
  process.stderr.write("\n");
  process.exitCode = 1;
};

const readFormattedSources = async (): Promise<readonly FormattedShellFile[]> => {
  const formattedSources = await Promise.all(
    paths.map(async (path) => {
      const source = await Bun.file(path).text();
      return { path, source, formatted: format(source, path, options) };
    }),
  );
  return formattedSources;
};

const check = async (): Promise<void> => {
  const formattedSources = await readFormattedSources();
  reportChanged(
    formattedSources.flatMap(({ path, source, formatted }) => (source === formatted ? [] : [path])),
  );
};

const write = async (): Promise<void> => {
  const formattedSources = await readFormattedSources();
  await Promise.all(
    formattedSources.map(async ({ path, formatted }) => {
      await Bun.write(path, formatted);
    }),
  );
};

await (runSync(program, { ...runOptions, args: Bun.argv.slice(2) }).write ? write : check)();

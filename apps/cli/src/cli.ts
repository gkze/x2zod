#!/usr/bin/env bun

export const main = (argv: readonly string[] = Bun.argv.slice(2)): void => {
  if (argv.length > 0) throw new Error("CLI is not implemented yet.");
};

if (import.meta.main) main();

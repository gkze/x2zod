import type { EslintPlugin } from "#rule";
import { compactArrowReturnsRule } from "#rules/compact-arrow-returns";
import { compactControlStatementsRule } from "#rules/compact-control-statements";
import { constArrowFunctionsRule } from "#rules/const-arrow-functions";
import { splitLongStringsRule } from "#rules/split-long-strings";

export const plugin: EslintPlugin = {
  meta: { name: "x2zod" },
  rules: {
    "compact-arrow-returns": compactArrowReturnsRule,
    "compact-control-statements": compactControlStatementsRule,
    "const-arrow-functions": constArrowFunctionsRule,
    "split-long-strings": splitLongStringsRule,
  },
};

export default plugin;

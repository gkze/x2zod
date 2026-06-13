import type { SourceFile } from "@typescript/native-preview/unstable/ast";
import type { RuleTester } from "oxlint/plugins-dev";

import { getNativeService } from "#source";
import { reportReplacement } from "#text";
import type { TextReplacement } from "#text";

export type Rule = Parameters<RuleTester["run"]>[1];
export type RuleContext = Parameters<NonNullable<Rule["create"]>>[0];
export type Diagnostic = Parameters<RuleContext["report"]>[0];
export type Fixer = Parameters<NonNullable<Diagnostic["fix"]>>[0];
export type Range = Parameters<Fixer["replaceTextRange"]>[0];
export type EslintPlugin = Readonly<{
  meta: Readonly<{ name: string }>;
  rules: Readonly<Record<string, Rule>>;
}>;

export interface SourceRuleOptions {
  collectReplacements: (context: RuleContext, sourceFile: SourceFile) => readonly TextReplacement[];
  description: string;
  message: string;
  schema?: readonly unknown[];
}

export const createSourceRule = ({
  collectReplacements,
  description,
  message,
  schema = [],
}: SourceRuleOptions): Rule => ({
  create: (context): Record<string, () => void> => ({
    Program: (): void => {
      const sourceContext = getNativeService(context).getSourceContext(context);

      if (sourceContext === undefined) return;

      for (const replacement of collectReplacements(context, sourceContext.sourceFile))
        reportReplacement(context, replacement);
    },
  }),
  meta: {
    docs: { description },
    fixable: "code",
    messages: { compact: message, convert: message, split: message },
    schema,
    type: "suggestion",
  },
});

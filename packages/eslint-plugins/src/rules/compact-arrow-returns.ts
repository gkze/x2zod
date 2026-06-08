import {
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isReturnStatement,
  SyntaxKind,
} from "@typescript/native-preview/ast";
import type { Expression, SourceFile, Block } from "@typescript/native-preview/ast";

import { createSourceRule } from "#rule";
import type { Rule, RuleContext } from "#rule";
import {
  containsCommentMarker,
  collectNodes,
  getNodeStart,
  minimumPositiveInteger,
  textForNode,
} from "#text";
import type { TextReplacement } from "#text";

const fallbackLineWidth = 80;
const returnKeywordWidth = "return".length;
const compactArrowDescription = [
  "replace block arrow returns with concise arrow bodies when",
  "safe",
].join(" ");
const compactArrowMessage = ["Compact arrow function", "return."].join(" ");

const fitsOnCurrentLine = (
  sourceText: string,
  replacementStart: number,
  replacementText: string,
): boolean => {
  if (replacementText.includes("\n")) return true;

  const lineStart = sourceText.lastIndexOf("\n", replacementStart - 1) + 1;
  const currentLinePrefix = sourceText.slice(lineStart, replacementStart);

  return currentLinePrefix.length + replacementText.length <= fallbackLineWidth;
};

const needsArrowBodyParentheses = (expression: Expression, expressionText: string): boolean =>
  expressionText.trimStart().startsWith("{") ||
  (isBinaryExpression(expression) && expression.operatorToken.kind === SyntaxKind.CommaToken);

const getCompactArrowBodyText = (sourceFile: SourceFile, body: Block): string | undefined => {
  const [statement] = body.statements;

  if (
    body.statements.length !== minimumPositiveInteger ||
    statement === undefined ||
    !isReturnStatement(statement)
  )
    return undefined;

  const { expression } = statement;

  if (expression === undefined) return undefined;

  const bodyStart = getNodeStart(sourceFile, body);
  const statementStart = getNodeStart(sourceFile, statement);
  const expressionStart = getNodeStart(sourceFile, expression);
  const beforeReturn = sourceFile.text.slice(bodyStart + minimumPositiveInteger, statementStart);
  const betweenReturnAndExpression = sourceFile.text.slice(
    statementStart + returnKeywordWidth,
    expressionStart,
  );
  const afterExpression = sourceFile.text.slice(expression.end, body.end - minimumPositiveInteger);

  if (
    containsCommentMarker(beforeReturn) ||
    containsCommentMarker(betweenReturnAndExpression) ||
    containsCommentMarker(afterExpression)
  )
    return undefined;

  const expressionText = textForNode(sourceFile, expression);
  const replacementBodyText = needsArrowBodyParentheses(expression, expressionText)
    ? `(${expressionText})`
    : expressionText;

  return fitsOnCurrentLine(sourceFile.text, bodyStart, replacementBodyText)
    ? replacementBodyText
    : undefined;
};

export const collectCompactArrowReturnReplacements = (
  sourceFile: SourceFile,
): readonly TextReplacement[] =>
  collectNodes(sourceFile, isArrowFunction).flatMap((arrowFunction) => {
    const { body } = arrowFunction;

    if (!isBlock(body)) return [];

    const replacementText = getCompactArrowBodyText(sourceFile, body);

    return replacementText === undefined
      ? []
      : [
          {
            end: body.end,
            messageId: "compact",
            replacementText,
            start: getNodeStart(sourceFile, body),
          },
        ];
  });

export const compactArrowReturnsRule: Rule = createSourceRule({
  collectReplacements: (_context: RuleContext, sourceFile: SourceFile) =>
    collectCompactArrowReturnReplacements(sourceFile),
  description: compactArrowDescription,
  message: compactArrowMessage,
});

import {
  isBlock,
  isContinueStatement,
  isDebuggerStatement,
  isDoStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isIfStatement,
  isThrowStatement,
  isWhileStatement,
  SyntaxKind,
} from "@typescript/native-preview/unstable/ast";
import type { Block, SourceFile, Statement } from "@typescript/native-preview/unstable/ast";

import { createSourceRule } from "#rule";
import type { Rule, RuleContext } from "#rule";
import {
  collectNodes,
  containsCommentMarker,
  getLineIndent,
  getLineStart,
  getNodeStart,
  isSameNode,
  minimumPositiveInteger,
  textForNode,
} from "#text";
import type { TextReplacement } from "#text";

const fallbackLineWidth = 80;
const simpleStatementKinds = new Set<SyntaxKind>([
  SyntaxKind.BreakStatement,
  SyntaxKind.ContinueStatement,
  SyntaxKind.DebuggerStatement,
  SyntaxKind.ExpressionStatement,
  SyntaxKind.ReturnStatement,
  SyntaxKind.ThrowStatement,
]);
const compactControlDescription = [
  "replace simple single-statement control blocks with compact control",
  "statements",
].join(" ");
const compactControlMessage = ["Compact single-statement control", "block."].join(" ");

type CompactControlledStatement = Readonly<{ replacementStart: number; replacementText: string }>;

const childIndent = "  ";

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

const isControlledBlock = (block: Block): boolean => {
  const { parent } = block;

  if (isIfStatement(parent))
    return isSameNode(parent.thenStatement, block) || isSameNode(parent.elseStatement, block);

  if (
    isDoStatement(parent) ||
    isForInStatement(parent) ||
    isForOfStatement(parent) ||
    isForStatement(parent) ||
    isWhileStatement(parent)
  )
    return isSameNode(parent.statement, block);

  return false;
};

const getPreBlockWhitespaceStart = (sourceText: string, bodyStart: number): number => {
  let index = bodyStart;

  while (index > 0) {
    const previousCharacter = sourceText[index - minimumPositiveInteger];

    if (previousCharacter !== " " && previousCharacter !== "\t") return index;

    index -= 1;
  }

  return index;
};

const getStatementIndent = (sourceFile: SourceFile, body: Block, statement: Statement): string => {
  const statementLineStart = getLineStart(sourceFile.text, getNodeStart(sourceFile, statement));
  const statementIndent = getLineIndent(sourceFile.text, statementLineStart);

  if (statementIndent.length > 0) return statementIndent;

  const controlLineStart = getLineStart(sourceFile.text, getNodeStart(sourceFile, body.parent));

  return `${getLineIndent(sourceFile.text, controlLineStart)}${childIndent}`;
};

const isSafelyCompactableStatement = (statement: Statement): boolean =>
  simpleStatementKinds.has(statement.kind) ||
  isContinueStatement(statement) ||
  isDebuggerStatement(statement) ||
  isThrowStatement(statement);

const getCompactControlledStatementText = (
  sourceFile: SourceFile,
  body: Block,
): CompactControlledStatement | undefined => {
  if (!isControlledBlock(body)) return undefined;

  const [statement] = body.statements;

  if (
    body.statements.length !== minimumPositiveInteger ||
    statement === undefined ||
    !isSafelyCompactableStatement(statement)
  )
    return undefined;

  const bodyStart = getNodeStart(sourceFile, body);
  const controlHeader = sourceFile.text.slice(getNodeStart(sourceFile, body.parent), bodyStart);
  const replacementStart = getPreBlockWhitespaceStart(sourceFile.text, bodyStart);
  const statementStart = getNodeStart(sourceFile, statement);
  const statementText = textForNode(sourceFile, statement);
  const beforeStatement = sourceFile.text.slice(bodyStart + minimumPositiveInteger, statementStart);
  const afterStatement = sourceFile.text.slice(statement.end, body.end - minimumPositiveInteger);

  if (
    containsCommentMarker(beforeStatement) ||
    containsCommentMarker(statementText) ||
    containsCommentMarker(afterStatement)
  )
    return undefined;

  const inlineReplacementText = ` ${statementText}`;

  return !controlHeader.includes("\n") &&
    !statementText.includes("\n") &&
    fitsOnCurrentLine(sourceFile.text, replacementStart, inlineReplacementText)
    ? { replacementStart, replacementText: inlineReplacementText }
    : {
        replacementStart,
        replacementText: `\n${getStatementIndent(sourceFile, body, statement)}${statementText}`,
      };
};

export const collectCompactControlStatementReplacements = (
  sourceFile: SourceFile,
): readonly TextReplacement[] =>
  collectNodes(sourceFile, isBlock).flatMap((block) => {
    const replacement = getCompactControlledStatementText(sourceFile, block);

    return replacement === undefined
      ? []
      : [
          {
            end: block.end,
            messageId: "compact",
            replacementText: replacement.replacementText,
            start: replacement.replacementStart,
          },
        ];
  });

export const compactControlStatementsRule: Rule = createSourceRule({
  collectReplacements: (_context: RuleContext, sourceFile: SourceFile) =>
    collectCompactControlStatementReplacements(sourceFile),
  description: compactControlDescription,
  message: compactControlMessage,
});

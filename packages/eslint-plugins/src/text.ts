import { getTokenPosOfNode } from "@typescript/native-preview/unstable/ast";
import type { Node, SourceFile } from "@typescript/native-preview/unstable/ast";

import type { Diagnostic, Range, RuleContext } from "#rule";

type DiagnosticLocation = NonNullable<Diagnostic["loc"]>;

export interface TextReplacement {
  readonly end: number;
  readonly messageId: string;
  readonly replacementText: string;
  readonly start: number;
}

export const minimumPositiveInteger = 1;
export const noIndex = -1;

export const containsCommentMarker = (value: string): boolean =>
  value.includes("//") || value.includes("/*");

export const getNodeStart = (sourceFile: SourceFile, node: Node): number =>
  getTokenPosOfNode(node, sourceFile);

export const textForNode = (sourceFile: SourceFile, node: Node): string =>
  sourceFile.text.slice(getNodeStart(sourceFile, node), node.end);

export const isSameNode = (left: Node | undefined, right: Node | undefined): boolean =>
  left !== undefined &&
  right !== undefined &&
  left.getSourceFile() === right.getSourceFile() &&
  left.pos === right.pos &&
  left.end === right.end &&
  left.kind === right.kind;

export const getLineStart = (sourceText: string, position: number): number =>
  sourceText.lastIndexOf("\n", position - minimumPositiveInteger) + minimumPositiveInteger;

export const getLineEnd = (sourceText: string, position: number): number => {
  const nextLineBreak = sourceText.indexOf("\n", position);

  return nextLineBreak === noIndex ? sourceText.length : nextLineBreak;
};

export const getLineIndent = (sourceText: string, lineStart: number): string => {
  let index = lineStart;

  while (sourceText[index] === " " || sourceText[index] === "\t") index += 1;

  return sourceText.slice(lineStart, index);
};

export const getLocation = (sourceText: string, position: number): DiagnosticLocation => {
  const lines = sourceText.slice(0, position).split("\n");
  const lastLine = lines.at(noIndex) ?? "";

  return { start: { column: lastLine.length, line: lines.length } };
};

export const reportReplacement = (context: RuleContext, replacement: TextReplacement): void => {
  context.report({
    fix: (fixer) =>
      fixer.replaceTextRange(
        [replacement.start, replacement.end] satisfies Range,
        replacement.replacementText,
      ),
    loc: getLocation(context.sourceCode.text, replacement.start),
    messageId: replacement.messageId,
  });
};

export const collectNodes = <TNode extends Node>(
  root: Node,
  test: (node: Node) => node is TNode,
): readonly TNode[] => {
  const nodes: TNode[] = [];
  const visitNode = (node: Node): undefined => {
    if (test(node)) nodes.push(node);
    node.forEachChild(visitNode);
  };

  visitNode(root);

  return nodes;
};

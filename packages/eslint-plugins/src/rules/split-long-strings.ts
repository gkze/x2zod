import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  isAsExpression,
  isBinaryExpression,
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isExpressionStatement,
  isIdentifier,
  isImportDeclaration,
  isJsxAttribute,
  isLiteralTypeNode,
  isNewExpression,
  isStringLiteral,
  SyntaxKind,
} from "@typescript/native-preview/ast";
import type { Node, SourceFile, StringLiteral } from "@typescript/native-preview/ast";

import { parseOptionsRecord } from "#options";
import { createSourceRule } from "#rule";
import type { Rule, RuleContext } from "#rule";
import { getNativeService } from "#source";
import {
  collectNodes,
  getLineIndent,
  getLineStart,
  getNodeStart,
  isSameNode,
  textForNode,
} from "#text";
import type { TextReplacement } from "#text";

interface StringFormatting {
  indentText: string;
  lineWidth: number;
  quoteStyle: QuoteStyle;
}

interface ChunkSearch {
  maxLiteralWidth: number;
  quoteStyle: QuoteStyle;
}

interface SplitStringOptions {
  continuationLiteralWidth: number;
  firstLiteralWidth: number;
  quoteStyle: QuoteStyle;
}

interface SplitLongStringsOptions {
  lineWidth?: number;
  oxfmtConfigPath?: string;
}

interface NodeWithName extends Node {
  readonly name?: Node;
}

interface NodeWithType extends Node {
  readonly type: Node;
}

type QuoteStyle = "double" | "single";

const defaultIndentWidth = 2;
const defaultLineWidth = 80;
const minimumChunkRatio = 0.6;
const stringLiteralContentEndOffset = -1;
const escapedSingleQuote = String.raw`\'`;
const lineWidthErrorMessage = ["split-long-strings lineWidth must be", "a positive integer."].join(
  " ",
);
const splitLongStringsDescription = [
  "split long string literals only when the TypeScript checker shows a widened",
  "string context",
].join(" ");
const splitLongStringsMessage = ["Split long string", "literal."].join(" ");
const defaultStringFormatting: StringFormatting = {
  indentText: " ".repeat(defaultIndentWidth),
  lineWidth: defaultLineWidth,
  quoteStyle: "double",
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const getIndentText = (useTabs: unknown, tabWidth: unknown): string =>
  useTabs === true ? "	" : " ".repeat(isPositiveInteger(tabWidth) ? tabWidth : defaultIndentWidth);

const parseOxfmtFormatting = (configText: string): StringFormatting => {
  const config = parseOptionsRecord(JSON.parse(configText));

  return {
    indentText: getIndentText(config["useTabs"], config["tabWidth"]),
    lineWidth: isPositiveInteger(config["printWidth"]) ? config["printWidth"] : defaultLineWidth,
    quoteStyle: config["singleQuote"] === true ? "single" : "double",
  };
};

const readOxfmtFormatting = (
  rootDir: string,
  options: SplitLongStringsOptions,
): StringFormatting => {
  const configPath = path.resolve(rootDir, options.oxfmtConfigPath ?? ".oxfmtrc.json");
  const configFormatting = existsSync(configPath)
    ? parseOxfmtFormatting(readFileSync(configPath, "utf8"))
    : defaultStringFormatting;

  if (options.lineWidth === undefined) return configFormatting;
  if (!isPositiveInteger(options.lineWidth)) throw new Error(lineWidthErrorMessage);

  return { ...configFormatting, lineWidth: options.lineWidth };
};

const isNamedNode = (node: Node): node is NodeWithName => "name" in node;

const isNodeWithType = (node: Node): node is NodeWithType => "type" in node;

const isNamePositionStringLiteral = (literal: StringLiteral): boolean => {
  const { parent } = literal;
  const nameNode = isNamedNode(parent) ? parent.name : undefined;

  return isSameNode(nameNode, literal);
};

const isStringLiteralExpressionStatement = (literal: StringLiteral): boolean =>
  isExpressionStatement(literal.parent);

const isRequireCallSpecifier = (literal: StringLiteral, parent: Node): boolean => {
  if (!isCallExpression(parent)) return false;

  const [firstArgument] = parent.arguments;

  return (
    firstArgument !== undefined &&
    isSameNode(firstArgument, literal) &&
    isIdentifier(parent.expression) &&
    parent.expression.text === "require"
  );
};

const isDynamicImportSpecifier = (literal: StringLiteral, parent: Node): boolean => {
  if (!isCallExpression(parent)) return false;

  const [firstArgument] = parent.arguments;

  return (
    firstArgument !== undefined &&
    isSameNode(firstArgument, literal) &&
    parent.expression.kind === SyntaxKind.ImportKeyword
  );
};

const isModuleSpecifierStringLiteral = (literal: StringLiteral): boolean => {
  const { parent } = literal;

  return (
    (isImportDeclaration(parent) && isSameNode(parent.moduleSpecifier, literal)) ||
    (isExportDeclaration(parent) && isSameNode(parent.moduleSpecifier, literal)) ||
    (isExternalModuleReference(parent) && isSameNode(parent.expression, literal)) ||
    isRequireCallSpecifier(literal, parent) ||
    isDynamicImportSpecifier(literal, parent)
  );
};

const isConstAssertionExpression = (sourceFile: SourceFile, node: Node): boolean => {
  if (isAsExpression(node)) return textForNode(sourceFile, node.type).trim() === "const";
  if (node.kind !== SyntaxKind.TypeAssertionExpression || !isNodeWithType(node)) return false;

  return textForNode(sourceFile, node.type).trim() === "const";
};

const isWithinConstAssertion = (sourceFile: SourceFile, literal: StringLiteral): boolean => {
  let current: Node = literal.parent;

  while (current.kind !== SyntaxKind.SourceFile) {
    if (isConstAssertionExpression(sourceFile, current)) return true;

    if (
      isCallExpression(current) ||
      isExpressionStatement(current) ||
      isJsxAttribute(current) ||
      isNewExpression(current)
    )
      return false;

    current = current.parent;
  }

  return false;
};

const isWithinStringConcatenation = (literal: StringLiteral): boolean => {
  let current: Node = literal.parent;

  while (current.kind !== SyntaxKind.SourceFile) {
    if (isBinaryExpression(current) && current.operatorToken.kind === SyntaxKind.PlusToken)
      return true;

    current = current.parent;
  }

  return false;
};

const isSafeStringLiteralToSplit = (
  context: RuleContext,
  sourceFile: SourceFile,
  literal: StringLiteral,
): boolean => {
  if (isNamePositionStringLiteral(literal)) return false;
  if (isStringLiteralExpressionStatement(literal)) return false;
  if (isModuleSpecifierStringLiteral(literal)) return false;
  if (isLiteralTypeNode(literal.parent)) return false;
  if (isJsxAttribute(literal.parent)) return false;
  if (isWithinConstAssertion(sourceFile, literal)) return false;
  if (isWithinStringConcatenation(literal)) return false;

  return getNativeService(context).isWidenedStringContext(
    context,
    getNodeStart(sourceFile, literal) + 1,
  );
};

const quoteStringLiteral = (value: string, quoteStyle: QuoteStyle): string => {
  const doubleQuoted = JSON.stringify(value);

  return quoteStyle === "double"
    ? doubleQuoted
    : `'${doubleQuoted.slice(1, stringLiteralContentEndOffset).replaceAll("'", escapedSingleQuote)}'`;
};

const findPreferredChunkEnd = (value: string, start: number, end: number): number => {
  const chunkLength = end - start;
  const minimumEnd = start + Math.max(1, Math.floor(chunkLength * minimumChunkRatio));

  for (let index = end - 1; index > minimumEnd; index -= 1)
    if (/\s/.test(value[index] ?? "")) return index;

  return end;
};

const getNextChunk = (
  value: string,
  start: number,
  { maxLiteralWidth, quoteStyle }: ChunkSearch,
): string => {
  let end = start + 1;
  let bestEnd = end;

  while (end <= value.length) {
    const candidate = value.slice(start, end);
    const candidateWidth = quoteStringLiteral(candidate, quoteStyle).length;

    if (candidateWidth > maxLiteralWidth) break;

    bestEnd = end;
    end += 1;
  }

  const chunkEnd =
    bestEnd === value.length ? bestEnd : findPreferredChunkEnd(value, start, bestEnd);

  return value.slice(start, chunkEnd);
};

const splitStringLiteralValue = (
  value: string,
  { continuationLiteralWidth, firstLiteralWidth, quoteStyle }: SplitStringOptions,
): readonly string[] => {
  const chunks: string[] = [];
  let start = 0;
  let maxLiteralWidth = firstLiteralWidth;

  while (start < value.length) {
    const chunk = getNextChunk(value, start, { maxLiteralWidth, quoteStyle });

    chunks.push(chunk);
    start += chunk.length;
    maxLiteralWidth = continuationLiteralWidth;
  }

  return chunks;
};

const getSplitStringReplacement = (
  sourceFile: SourceFile,
  literal: StringLiteral,
  formatting: StringFormatting,
): string | undefined => {
  const value = literal.text;

  if (value.length === 0) return undefined;

  const literalStart = getNodeStart(sourceFile, literal);
  const lineStart = getLineStart(sourceFile.text, literalStart);
  const literalText = textForNode(sourceFile, literal);
  const currentLinePrefix = sourceFile.text.slice(lineStart, literalStart);

  if (currentLinePrefix.length + literalText.length <= formatting.lineWidth) return undefined;

  const lineIndent = getLineIndent(sourceFile.text, lineStart);
  const continuationIndent = lineIndent + formatting.indentText;
  const firstPrefixWidth = literalStart - lineStart;
  const wrappedFirstPrefixWidth = firstPrefixWidth + "(".length;
  const firstLiteralWidth = Math.max(
    1,
    formatting.lineWidth - wrappedFirstPrefixWidth - " +".length,
  );
  const continuationLiteralWidth = Math.max(
    1,
    formatting.lineWidth - continuationIndent.length - " +".length,
  );
  const chunks = splitStringLiteralValue(value, {
    continuationLiteralWidth,
    firstLiteralWidth,
    quoteStyle: formatting.quoteStyle,
  });

  if (chunks.length < 2) return undefined;

  return chunks
    .map((chunk, index) => {
      const linePrefix = index === 0 ? "" : continuationIndent;
      const operatorSuffix = index === chunks.length - 1 ? "" : " +";

      return linePrefix + quoteStringLiteral(chunk, formatting.quoteStyle) + operatorSuffix;
    })
    .join("\n");
};

const parseOptions = (context: RuleContext): SplitLongStringsOptions => {
  const [rawOptions] = context.options;
  const rawOptionsRecord = parseOptionsRecord(rawOptions);
  const { lineWidth, oxfmtConfigPath } = rawOptionsRecord;
  const options: SplitLongStringsOptions = {};

  if (typeof lineWidth === "number") options.lineWidth = lineWidth;
  if (typeof oxfmtConfigPath === "string") options.oxfmtConfigPath = oxfmtConfigPath;

  return options;
};

export const collectSplitLongStringReplacements = (
  context: RuleContext,
  sourceFile: SourceFile,
): readonly TextReplacement[] => {
  const formatting = readOxfmtFormatting(context.cwd, parseOptions(context));

  return collectNodes(sourceFile, isStringLiteral).flatMap((literal) => {
    if (!isSafeStringLiteralToSplit(context, sourceFile, literal)) return [];

    const replacementText = getSplitStringReplacement(sourceFile, literal, formatting);

    return replacementText === undefined
      ? []
      : [
          {
            end: literal.end,
            messageId: "split",
            replacementText: `(${replacementText})`,
            start: getNodeStart(sourceFile, literal),
          },
        ];
  });
};

export const splitLongStringsRule: Rule = createSourceRule({
  collectReplacements: collectSplitLongStringReplacements,
  description: splitLongStringsDescription,
  message: splitLongStringsMessage,
  schema: [
    {
      additionalProperties: false,
      properties: {
        lineWidth: { minimum: 1, type: "integer" },
        oxfmtConfigPath: { type: "string" },
      },
      type: "object",
    },
  ],
});

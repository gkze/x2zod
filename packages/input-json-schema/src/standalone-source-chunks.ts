import { SyntaxKind } from "@typescript/native-preview/unstable/ast";

import { scanAjvStandaloneTokens } from "./ajv-standalone-source";
import type { AjvStandaloneToken } from "./ajv-standalone-source";

type SourceRange = Readonly<{ end: number; start: number }>;
const largeValidatorBodyLength = 80_000;
const targetChunkLength = 30_000;
const lastItemIndex = -1;
type Delimiter = Readonly<{
  kind: "brace" | "bracket" | "paren" | "template";
  start?: number | undefined;
}>;
type SourceContext = Readonly<{
  closingDelimiter: ReadonlyMap<number, number>;
  source: string;
  tokens: readonly AjvStandaloneToken[];
}>;

const closesDelimiter = (token: SyntaxKind, delimiter: Delimiter["kind"]): boolean =>
  (token === SyntaxKind.CloseBraceToken && (delimiter === "brace" || delimiter === "template")) ||
  (token === SyntaxKind.CloseBracketToken && delimiter === "bracket") ||
  (token === SyntaxKind.CloseParenToken && delimiter === "paren");

const sourceContext = (source: string): SourceContext => {
  const closingDelimiter = new Map<number, number>();
  const delimiters: Delimiter[] = [];
  const tokens = scanAjvStandaloneTokens(source);
  for (const token of tokens) {
    const top = delimiters.at(lastItemIndex);
    if (token.kind === SyntaxKind.OpenBraceToken)
      delimiters.push({ kind: "brace", start: token.start });
    else if (token.kind === SyntaxKind.OpenBracketToken)
      delimiters.push({ kind: "bracket", start: token.start });
    else if (token.kind === SyntaxKind.OpenParenToken)
      delimiters.push({ kind: "paren", start: token.start });
    else if (token.kind === SyntaxKind.TemplateHead || token.kind === SyntaxKind.TemplateMiddle)
      delimiters.push({ kind: "template" });
    else if (top !== undefined && closesDelimiter(token.kind, top.kind)) {
      delimiters.pop();
      if (top.start !== undefined) closingDelimiter.set(top.start, token.start);
    }
  }
  return { closingDelimiter, source, tokens };
};

const tokenAfter = (context: SourceContext, position: number): AjvStandaloneToken | undefined =>
  context.tokens.find((token) => token.start >= position);

const functionBodyOpening = (
  context: SourceContext,
  parameterOpening: number,
): number | undefined => {
  const parameterClosing = context.closingDelimiter.get(parameterOpening);
  if (parameterClosing === undefined) return undefined;
  const opening = tokenAfter(context, parameterClosing + 1);
  return opening?.kind === SyntaxKind.OpenBraceToken ? opening.start : undefined;
};

type NestingDepth = Readonly<{ brace: number; bracket: number; parenthesis: number }>;
const nestingDepthAfter = (depth: NestingDepth, token: SyntaxKind): NestingDepth => {
  if (token === SyntaxKind.OpenBraceToken) return { ...depth, brace: depth.brace + 1 };
  if (token === SyntaxKind.CloseBraceToken) return { ...depth, brace: depth.brace - 1 };
  if (token === SyntaxKind.OpenBracketToken) return { ...depth, bracket: depth.bracket + 1 };
  if (token === SyntaxKind.CloseBracketToken) return { ...depth, bracket: depth.bracket - 1 };
  if (token === SyntaxKind.OpenParenToken) return { ...depth, parenthesis: depth.parenthesis + 1 };
  return token === SyntaxKind.CloseParenToken
    ? { ...depth, parenthesis: depth.parenthesis - 1 }
    : depth;
};
const blockContinuationKinds: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.CatchKeyword,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CommaToken,
  SyntaxKind.ElseKeyword,
  SyntaxKind.FinallyKeyword,
  SyntaxKind.SemicolonToken,
  SyntaxKind.WhileKeyword,
]);
const endsDirectStatement = (
  depth: NestingDepth,
  token: AjvStandaloneToken,
  next: AjvStandaloneToken | undefined,
): boolean =>
  depth.brace === 0 &&
  depth.bracket === 0 &&
  depth.parenthesis === 0 &&
  (token.kind === SyntaxKind.SemicolonToken ||
    (token.kind === SyntaxKind.CloseBraceToken &&
      (next === undefined || !blockContinuationKinds.has(next.kind))));

const directStatementRanges = (
  context: SourceContext,
  start: number,
  end: number,
): readonly SourceRange[] => {
  const { source, tokens } = context;
  const ranges: SourceRange[] = [];
  let statementStart = start;
  let depth: NestingDepth = { brace: 0, bracket: 0, parenthesis: 0 };
  const finishStatement = (statementEnd: number): void => {
    if (source.slice(statementStart, statementEnd).trim() !== "")
      ranges.push({ end: statementEnd, start: statementStart });
    statementStart = statementEnd;
  };
  const rangeTokens = tokens.filter((token) => token.start >= start && token.end <= end);
  for (const [index, token] of rangeTokens.entries()) {
    depth = nestingDepthAfter(depth, token.kind);
    if (endsDirectStatement(depth, token, rangeTokens[index + 1])) finishStatement(token.end);
  }
  finishStatement(end);
  return ranges;
};
type Block = Readonly<{ closing: number; opening: number }>;
const followingBraceBlock = (
  context: SourceContext,
  closingParenthesis: number,
  end: number,
): Block | undefined => {
  const openingToken = tokenAfter(context, closingParenthesis + 1);
  if (openingToken?.kind !== SyntaxKind.OpenBraceToken) return undefined;
  const { start: opening } = openingToken;
  const closing = context.closingDelimiter.get(opening);
  return closing === undefined || closing > end ? undefined : { closing, opening };
};
const isPreliminaryIf = (source: string, opening: number, closing: number): boolean => {
  const condition = source.slice(opening + 1, closing).trimStart();
  return /^evaluated\d*\b/u.test(condition) || /^!\s*dynamicAnchors\b/u.test(condition);
};
const ifBlock = (
  context: SourceContext,
  end: number,
  openingParenthesis: AjvStandaloneToken,
): Block | undefined => {
  const closingParenthesis = context.closingDelimiter.get(openingParenthesis.start);
  if (
    closingParenthesis === undefined ||
    isPreliminaryIf(context.source, openingParenthesis.start, closingParenthesis)
  )
    return undefined;
  return followingBraceBlock(context, closingParenthesis, end);
};
const validationIfBlock = (input: {
  readonly context: SourceContext;
  readonly end: number;
  readonly start: number;
}): Block | undefined => {
  const { context, end, start } = input;
  let result: Block | undefined = undefined;
  for (let index = 0; index + 1 < context.tokens.length; index += 1) {
    const token = context.tokens[index];
    const openingParenthesis = context.tokens[index + 1];
    if (
      result === undefined &&
      token !== undefined &&
      openingParenthesis !== undefined &&
      token.kind === SyntaxKind.IfKeyword &&
      token.start >= start &&
      token.end <= end &&
      openingParenthesis.kind === SyntaxKind.OpenParenToken
    )
      result = ifBlock(context, end, openingParenthesis);
  }
  return result;
};
const hasDirectDeclaration = (source: string, range: SourceRange): boolean =>
  /^(?:\s*)(?:let|const|var)\b/u.test(source.slice(range.start, range.end));
type ChunkRanges = Readonly<{
  chunks: readonly (readonly SourceRange[])[];
  movedStart: number | undefined;
}>;
const chunkRanges = (source: string, ranges: readonly SourceRange[]): ChunkRanges => {
  let firstMovable = 0;
  let firstRange = ranges[firstMovable];
  while (firstRange !== undefined && hasDirectDeclaration(source, firstRange)) {
    firstMovable += 1;
    firstRange = ranges[firstMovable];
  }
  if (ranges.slice(firstMovable).some((range) => hasDirectDeclaration(source, range)))
    return { chunks: [ranges], movedStart: undefined };
  const movableRanges = ranges.slice(firstMovable);
  if (movableRanges.length === 0) return { chunks: [ranges], movedStart: undefined };
  const chunks: SourceRange[][] = [];
  let current: SourceRange[] = [];
  let currentLength = 0;
  for (const range of movableRanges) {
    const length = range.end - range.start;
    if (current.length > 0 && currentLength + length > targetChunkLength) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(range);
    currentLength += length;
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, movedStart: movableRanges[0]?.start };
};
const helperSource = (source: string, name: string, ranges: readonly SourceRange[]): string => {
  const statements = ranges.map((range) => source.slice(range.start, range.end)).join("");
  return [`const ${name} = () => {`, statements, "};"].join("\n");
};
type ValidatorLocation = Readonly<{ name: string; parameterOpening: number; start: number }>;
type ValidatorRewrite = Readonly<{ end: number; replacement: string; start: number }>;
const validatorLocations = (
  tokens: readonly AjvStandaloneToken[],
): readonly ValidatorLocation[] => {
  const locations: ValidatorLocation[] = [];
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const functionToken = tokens[index];
    const nameToken = tokens[index + 1];
    const parameterOpening = tokens[index + 2];
    if (
      functionToken?.kind === SyntaxKind.FunctionKeyword &&
      nameToken?.kind === SyntaxKind.Identifier &&
      /^validate\d+$/u.test(nameToken.text) &&
      parameterOpening?.kind === SyntaxKind.OpenParenToken
    )
      locations.push({
        name: nameToken.text,
        parameterOpening: parameterOpening.start,
        start: functionToken.start,
      });
  }
  return locations;
};
const unsafeMovedRangeIndexes = (
  ranges: readonly SourceRange[],
  tokens: readonly AjvStandaloneToken[],
): ReadonlySet<number> => {
  const unsafeKeywords = new Set(["return", "var"]);
  const loopKeywords = new Set([
    SyntaxKind.DoKeyword,
    SyntaxKind.ForKeyword,
    SyntaxKind.WhileKeyword,
  ]);
  const unsafe = new Set<number>();
  let rangeIndex = 0;
  for (const token of tokens) {
    while (rangeIndex < ranges.length && token.start >= (ranges[rangeIndex]?.end ?? 0))
      rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (
      range !== undefined &&
      token.start >= range.start &&
      token.end <= range.end &&
      (unsafeKeywords.has(token.text) ||
        ((token.text === "break" || token.text === "continue") &&
          !tokens.some(
            (candidate) =>
              candidate.start >= range.start &&
              candidate.start < token.start &&
              loopKeywords.has(candidate.kind),
          )))
    )
      unsafe.add(rangeIndex);
  }
  return unsafe;
};
const nestedForBody = (context: SourceContext, range: SourceRange): Block | undefined => {
  const tokens = context.tokens.filter(
    (token) => token.start >= range.start && token.end <= range.end,
  );
  const [forToken, openingParenthesis] = tokens;
  if (
    forToken?.kind !== SyntaxKind.ForKeyword ||
    openingParenthesis?.kind !== SyntaxKind.OpenParenToken
  )
    return undefined;
  const closingParenthesis = context.closingDelimiter.get(openingParenthesis.start);
  if (closingParenthesis === undefined) return undefined;
  return followingBraceBlock(context, closingParenthesis, range.end);
};
type ChunkGroup = Readonly<{
  chunks: readonly (readonly SourceRange[])[];
  movedEnd: number;
  movedStart: number;
}>;
type ChunkPlan = Readonly<{ block: Block; groups: readonly ChunkGroup[] }>;
const chunkGroup = (source: string, ranges: readonly SourceRange[]): ChunkGroup | undefined => {
  const { chunks, movedStart } = chunkRanges(source, ranges);
  const lastChunk = chunks.at(lastItemIndex);
  const movedEnd = lastChunk?.at(lastItemIndex)?.end;
  return chunks.length === 0 || movedStart === undefined || movedEnd === undefined
    ? undefined
    : { chunks, movedEnd, movedStart };
};
const safeChunkGroups = (
  source: string,
  ranges: readonly SourceRange[],
  tokens: readonly AjvStandaloneToken[],
): readonly ChunkGroup[] => {
  const unsafe = unsafeMovedRangeIndexes(ranges, tokens);
  const groups: ChunkGroup[] = [];
  let current: SourceRange[] = [];
  const flush = (): void => {
    const group = chunkGroup(source, current);
    if (group !== undefined) groups.push(group);
    current = [];
  };
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (range === undefined || unsafe.has(index) || hasDirectDeclaration(source, range)) flush();
    else current.push(range);
  }
  flush();
  return groups;
};
const chunkPlan = (context: SourceContext, block: Block): ChunkPlan | undefined => {
  const ranges = directStatementRanges(context, block.opening + 1, block.closing);
  const groups = safeChunkGroups(context.source, ranges, context.tokens);
  if (ranges.length !== 1 && groups.length > 0) return { block, groups };
  if (ranges.length !== 1) return undefined;
  const [onlyRange] = ranges;
  if (onlyRange === undefined) return undefined;
  const nestedBlock = nestedForBody(context, onlyRange);
  if (groups.length > 0 && nestedBlock === undefined) return { block, groups };
  if (nestedBlock === undefined) return undefined;
  const nestedRanges = directStatementRanges(context, nestedBlock.opening + 1, nestedBlock.closing);
  const nestedGroups = safeChunkGroups(context.source, nestedRanges, context.tokens);
  return nestedGroups.length > 0 ? { block: nestedBlock, groups: nestedGroups } : undefined;
};
const uniqueHelperName = (source: string, name: string, used: Set<string>): string => {
  const base = `x2zod${name}Chunk`;
  let candidate = base;
  while (source.includes(candidate) || used.has(candidate)) candidate += "X";
  used.add(candidate);
  return candidate;
};
const rewriteValidator = (input: {
  readonly context: SourceContext;
  readonly usedHelperNames: Set<string>;
  readonly validator: ValidatorLocation;
}): ValidatorRewrite | undefined => {
  const { context, usedHelperNames, validator } = input;
  const { source } = context;
  const functionOpening = functionBodyOpening(context, validator.parameterOpening);
  if (functionOpening === undefined) return undefined;
  const functionClosing = context.closingDelimiter.get(functionOpening);
  if (functionClosing === undefined || functionClosing - functionOpening < largeValidatorBodyLength)
    return undefined;
  const conditional = validationIfBlock({
    context,
    end: functionClosing,
    start: functionOpening + 1,
  });
  if (conditional === undefined) return undefined;
  const plan = chunkPlan(context, conditional);
  if (plan === undefined) return undefined;
  const { block, groups } = plan;
  const edits = groups.flatMap((group) => {
    const helperNames = group.chunks.map((_chunk, index) => {
      const baseName = uniqueHelperName(source, validator.name, usedHelperNames);
      return `${baseName}${index.toString()}`;
    });
    const helpers = group.chunks
      .map((chunk, index) => helperSource(source, helperNames[index] ?? "", chunk))
      .join("\n");
    return [
      {
        end: group.movedEnd,
        replacement: `${helpers}\n${helperNames.map((name) => `${name}();`).join("\n")}\n`,
        start: group.movedStart,
      },
    ];
  });
  let body = source.slice(block.opening + 1, block.closing);
  for (const edit of edits.toSorted((left, right) => right.start - left.start))
    body = `${body.slice(0, edit.start - block.opening - 1)}${edit.replacement}${body.slice(edit.end - block.opening - 1)}`;
  const replacement = `${source.slice(block.opening + 1, block.opening + 1)}${body}`;
  return {
    end: functionClosing + 1,
    replacement: `${source.slice(validator.start, block.opening + 1)}${replacement}${source.slice(block.closing, functionClosing + 1)}`,
    start: validator.start,
  };
};
export const chunkOversizedAjvValidator = (source: string): string => {
  const usedHelperNames = new Set<string>();
  const context = sourceContext(source);
  const rewrites = validatorLocations(context.tokens)
    .map((validator) => rewriteValidator({ context, usedHelperNames, validator }))
    .filter((rewrite): rewrite is ValidatorRewrite => rewrite !== undefined)
    .toSorted((left, right) => right.start - left.start);
  let rewritten = source;
  for (const rewrite of rewrites)
    rewritten = `${rewritten.slice(0, rewrite.start)}${rewrite.replacement}${rewritten.slice(rewrite.end)}`;
  return rewritten;
};

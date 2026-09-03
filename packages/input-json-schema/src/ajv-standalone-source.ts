import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "@typescript/native-preview/unstable/ast";

export type AjvStandaloneToken = Readonly<{
  end: number;
  kind: SyntaxKind;
  start: number;
  text: string;
  value: string;
}>;

type SourceEdit = Readonly<{ end: number; replacement: string; start: number }>;

type Delimiter =
  | Readonly<{ kind: "brace"; endsExpression: boolean }>
  | Readonly<{ kind: "bracket"; endsExpression: true }>
  | Readonly<{ kind: "paren"; endsExpression: boolean }>
  | Readonly<{ kind: "template"; endsExpression: false }>;

type AjvStandaloneSourceAnalysis = Readonly<{
  normalizedSource: string;
  runtimeDependencies: readonly string[];
}>;

const identifierTextPattern = /^[A-Za-z_$][\w$]*$/u;
const resAssignmentPattern = /^res\d+$/u;
const exportEqualsOffset = 3;
const exportNameOffset = 2;
const finiteGuardTokenCount = 8;
const lastItemOffset = -1;
const requireCloseOffset = 3;

const nonCodeTokenKinds: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.MultiLineCommentTrivia,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.SingleLineCommentTrivia,
  SyntaxKind.StringLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
]);

const expressionEndingTokenKinds: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.BigIntLiteral,
  SyntaxKind.Identifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.ThisKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
  SyntaxKind.UndefinedKeyword,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
]);

const controlParenKeywords: ReadonlySet<string> = new Set([
  "catch",
  "for",
  "if",
  "switch",
  "while",
  "with",
]);

const isNonCodeToken = (token: AjvStandaloneToken): boolean => nonCodeTokenKinds.has(token.kind);

const isNameToken = (token: AjvStandaloneToken | undefined): token is AjvStandaloneToken =>
  token !== undefined && !isNonCodeToken(token) && identifierTextPattern.test(token.text);

const canEndExpression = (token: AjvStandaloneToken | undefined): boolean =>
  token !== undefined &&
  (expressionEndingTokenKinds.has(token.kind) ||
    token.kind === SyntaxKind.CloseBracketToken ||
    token.kind === SyntaxKind.CloseBraceToken ||
    token.kind === SyntaxKind.CloseParenToken);

const isLikelyBlockBrace = (previous: AjvStandaloneToken | undefined): boolean =>
  previous === undefined ||
  previous.kind === SyntaxKind.CloseParenToken ||
  previous.kind === SyntaxKind.CloseBraceToken ||
  previous.kind === SyntaxKind.CloseBracketToken ||
  previous.kind === SyntaxKind.EqualsGreaterThanToken ||
  previous.kind === SyntaxKind.ElseKeyword ||
  previous.kind === SyntaxKind.FinallyKeyword ||
  previous.kind === SyntaxKind.TryKeyword ||
  previous.kind === SyntaxKind.DoKeyword ||
  previous.kind === SyntaxKind.ClassKeyword ||
  previous.kind === SyntaxKind.InterfaceKeyword ||
  previous.kind === SyntaxKind.EnumKeyword ||
  previous.kind === SyntaxKind.ModuleKeyword ||
  previous.kind === SyntaxKind.NamespaceKeyword;

const popDelimiter = (delimiters: Delimiter[], kind: Delimiter["kind"]): Delimiter | undefined => {
  const delimiter = delimiters.at(lastItemOffset);
  if (delimiter?.kind !== kind) return undefined;
  delimiters.pop();
  return delimiter;
};

const tokenEndsExpression = (
  token: AjvStandaloneToken,
  closingDelimiter: Delimiter | undefined,
): boolean => {
  if (closingDelimiter !== undefined) return closingDelimiter.endsExpression;
  if (token.kind === SyntaxKind.TemplateHead || token.kind === SyntaxKind.TemplateMiddle)
    return false;
  return canEndExpression(token);
};

export const scanAjvStandaloneTokens = (source: string): readonly AjvStandaloneToken[] => {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const delimiters: Delimiter[] = [];
  const tokens: AjvStandaloneToken[] = [];
  let previous: AjvStandaloneToken | undefined = undefined;
  let previousEndsExpression = false;

  for (;;) {
    let kind = scanner.scan();
    if (
      kind === SyntaxKind.SlashToken &&
      !previousEndsExpression &&
      scanner.getTokenText().startsWith("/")
    )
      kind = scanner.reScanSlashToken();

    if (kind === SyntaxKind.EndOfFile) break;

    const token: AjvStandaloneToken = {
      end: scanner.getTokenEnd(),
      kind,
      start: scanner.getTokenStart(),
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    };
    let closingDelimiter: Delimiter | undefined = undefined;
    if (kind === SyntaxKind.CloseBraceToken) {
      const delimiter = delimiters.at(lastItemOffset);
      if (delimiter?.kind === "brace" || delimiter?.kind === "template") {
        delimiters.pop();
        closingDelimiter = delimiter;
      }
    } else if (kind === SyntaxKind.CloseBracketToken)
      closingDelimiter = popDelimiter(delimiters, "bracket");
    else if (kind === SyntaxKind.CloseParenToken)
      closingDelimiter = popDelimiter(delimiters, "paren");

    const endsExpression = tokenEndsExpression(token, closingDelimiter);
    tokens.push(token);

    if (kind === SyntaxKind.OpenBraceToken)
      delimiters.push({ endsExpression: !isLikelyBlockBrace(previous), kind: "brace" });
    else if (kind === SyntaxKind.OpenBracketToken)
      delimiters.push({ endsExpression: true, kind: "bracket" });
    else if (kind === SyntaxKind.OpenParenToken)
      delimiters.push({
        endsExpression: !controlParenKeywords.has(previous?.text ?? ""),
        kind: "paren",
      });
    else if (kind === SyntaxKind.TemplateHead || kind === SyntaxKind.TemplateMiddle)
      delimiters.push({ endsExpression: false, kind: "template" });

    previous = token;
    previousEndsExpression = endsExpression;
  }
  return tokens;
};

const runtimeDependencies = (tokens: readonly AjvStandaloneToken[]): readonly string[] =>
  tokens
    .flatMap((token, index) => {
      if (
        token.text !== "require" ||
        tokens[index - 1]?.kind === SyntaxKind.DotToken ||
        tokens[index - 1]?.kind === SyntaxKind.QuestionDotToken ||
        tokens[index - 1]?.kind === SyntaxKind.HashToken
      )
        return [];
      const openParen = tokens[index + 1];
      const specifier = tokens[index + 2];
      const closeParen = tokens[index + requireCloseOffset];
      if (
        openParen?.kind !== SyntaxKind.OpenParenToken ||
        specifier?.kind !== SyntaxKind.StringLiteral ||
        closeParen?.kind !== SyntaxKind.CloseParenToken
      )
        return [];
      return [specifier.value];
    })
    .toSorted()
    .filter(
      (dependency, index, dependencies) => index === 0 || dependency !== dependencies[index - 1],
    );

const isUseStrictDirective = (token: AjvStandaloneToken | undefined): boolean =>
  token?.kind === SyntaxKind.StringLiteral && token.value === "use strict";

const useStrictEdits = (
  source: string,
  tokens: readonly AjvStandaloneToken[],
): readonly SourceEdit[] => {
  const [first, second] = tokens;
  if (first === undefined || !isUseStrictDirective(first)) return [];
  if (
    second !== undefined &&
    second.kind !== SyntaxKind.SemicolonToken &&
    !source.slice(first.end, second.start).includes("\n") &&
    !source.slice(first.end, second.start).includes("\r")
  )
    return [];
  return [
    { end: first.end, replacement: "", start: first.start },
    ...(second?.kind === SyntaxKind.SemicolonToken
      ? [{ end: second.end, replacement: "", start: second.start }]
      : []),
  ];
};

const exportPrefixEdits = (tokens: readonly AjvStandaloneToken[]): readonly SourceEdit[] => {
  const edits: SourceEdit[] = [];
  for (let index = 0; index + exportEqualsOffset < tokens.length; index += 1) {
    const exportToken = tokens[index];
    if (
      exportToken !== undefined &&
      exportToken.kind === SyntaxKind.ExportKeyword &&
      tokens[index + 1]?.kind === SyntaxKind.ConstKeyword &&
      isNameToken(tokens[index + exportNameOffset]) &&
      tokens[index + exportEqualsOffset]?.kind === SyntaxKind.EqualsToken
    )
      edits.push({ end: exportToken.end, replacement: "", start: exportToken.start });
  }
  return edits;
};

const defaultExportEdits = (tokens: readonly AjvStandaloneToken[]): readonly SourceEdit[] => {
  const edits: SourceEdit[] = [];
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const exportToken = tokens[index];
    const defaultToken = tokens[index + 1];
    const identifierToken = tokens[index + 2];
    if (
      exportToken?.kind === SyntaxKind.ExportKeyword &&
      defaultToken?.kind === SyntaxKind.DefaultKeyword &&
      isNameToken(identifierToken)
    )
      edits.push({ end: identifierToken.start, replacement: "", start: exportToken.start });
  }
  return edits;
};

const propertyAccessEdits = (tokens: readonly AjvStandaloneToken[]): readonly SourceEdit[] => {
  const edits: SourceEdit[] = [];
  for (let index = 1; index + 1 < tokens.length; index += 1) {
    const dot = tokens[index];
    const property = tokens[index + 1];
    if (
      dot !== undefined &&
      property !== undefined &&
      dot.kind === SyntaxKind.DotToken &&
      (property.text === "errors" || property.text === "evaluated")
    ) {
      let baseIndex = index - 1;
      while (
        baseIndex >= 2 &&
        tokens[baseIndex - 1]?.kind === SyntaxKind.DotToken &&
        isNameToken(tokens[baseIndex - 2])
      )
        baseIndex -= 2;
      const base = tokens[baseIndex];
      if (isNameToken(base))
        edits.push(
          { end: base.start, replacement: "(", start: base.start },
          { end: dot.start, replacement: " as any)", start: dot.start },
        );
    }
  }
  return edits;
};

const finiteGuardAlreadyPresent = (
  tokens: readonly AjvStandaloneToken[],
  commaIndex: number,
  variable: string,
): boolean => {
  const guard = tokens
    .slice(commaIndex + 1, commaIndex + 1 + finiteGuardTokenCount)
    .map((token) => token.text);
  return guard.join("") === `!Number.isFinite(${variable})||`;
};

const quotientCommaIndex = (
  tokens: readonly AjvStandaloneToken[],
  index: number,
): number | undefined => {
  let parentheses = 1;
  let braces = 0;
  let brackets = 0;
  for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token === undefined) return undefined;
    if (token.kind === SyntaxKind.OpenParenToken) parentheses += 1;
    else if (token.kind === SyntaxKind.CloseParenToken) parentheses -= 1;
    else if (token.kind === SyntaxKind.OpenBraceToken) braces += 1;
    else if (token.kind === SyntaxKind.CloseBraceToken) braces -= 1;
    else if (token.kind === SyntaxKind.OpenBracketToken) brackets += 1;
    else if (token.kind === SyntaxKind.CloseBracketToken) brackets -= 1;
    else if (
      token.kind === SyntaxKind.CommaToken &&
      parentheses === 1 &&
      braces === 0 &&
      brackets === 0
    )
      return cursor;
    if (parentheses === 0) return undefined;
  }
  return undefined;
};

const quotientOverflowEdit = (
  tokens: readonly AjvStandaloneToken[],
  index: number,
): SourceEdit | undefined => {
  if (tokens[index]?.kind !== SyntaxKind.OpenParenToken) return undefined;
  const variable = tokens[index + 1];
  if (!isNameToken(variable) || !resAssignmentPattern.test(variable.text)) return undefined;
  if (tokens[index + 2]?.kind !== SyntaxKind.EqualsToken) return undefined;
  const commaIndex = quotientCommaIndex(tokens, index);
  if (commaIndex === undefined) return undefined;
  const comma = tokens[commaIndex];
  if (comma === undefined || finiteGuardAlreadyPresent(tokens, commaIndex, variable.text))
    return undefined;
  return {
    end: comma.end,
    replacement: `, !Number.isFinite(${variable.text}) ||`,
    start: comma.start,
  };
};

const quotientOverflowEdits = (tokens: readonly AjvStandaloneToken[]): readonly SourceEdit[] => {
  const edits: SourceEdit[] = [];
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const edit = quotientOverflowEdit(tokens, index);
    if (edit !== undefined) edits.push(edit);
  }
  return edits;
};

const applyEdits = (source: string, edits: readonly SourceEdit[]): string => {
  let result = source;
  for (const edit of edits.toSorted(
    (left, right) => right.start - left.start || right.end - left.end,
  ))
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  return result;
};

const sourceNormalizationEdits = (
  source: string,
  tokens: readonly AjvStandaloneToken[],
): readonly SourceEdit[] => [
  ...useStrictEdits(source, tokens),
  ...exportPrefixEdits(tokens),
  ...defaultExportEdits(tokens),
  ...propertyAccessEdits(tokens),
  ...quotientOverflowEdits(tokens),
];

export const analyzeAjvStandaloneSource = (source: string): AjvStandaloneSourceAnalysis => {
  const tokens = scanAjvStandaloneTokens(source);
  return {
    normalizedSource: applyEdits(source, sourceNormalizationEdits(source, tokens)),
    runtimeDependencies: runtimeDependencies(tokens),
  };
};

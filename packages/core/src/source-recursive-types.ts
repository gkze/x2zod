import { SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  PropertyName,
  Statement,
  TypeElement,
  TypeNode,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrayTypeNode,
  createIdentifier,
  createIntersectionTypeNode,
  createKeywordExpression,
  createKeywordTypeNode,
  createLiteralTypeNode,
  createNumericLiteral,
  createPropertySignatureDeclaration,
  createStringLiteral,
  createToken,
  createTupleTypeNode,
  createTypeAliasDeclaration,
  createTypeLiteralNode,
  createTypeQueryNode,
  createTypeReferenceNode,
  createUnionTypeNode,
} from "@typescript/native-preview/unstable/ast/factory";

import { createSourceZodType as zodType } from "./source-ast";
import type {
  SourceArgument,
  SourceEmissionModule,
  SourceExpression,
  SourceFactoryExpression,
  SourceMethodCall,
  SourceReferenceExpression,
} from "./source-model";
import type { TypeScriptIdentifierAllocator } from "./typescript-identifiers";
import { isTypeScriptIdentifier } from "./typescript-identifiers";
import type { ZodLiteralValue, ZodSymbol } from "./zod-plan";

const noTokenFlags = 0;

type TypeProjection = "input" | "output";

export type RecursiveDeclarationTypeNames = Readonly<{
  input: string;
  output: string;
  schema: string;
}>;

type RecursiveDeclarationTypes = Readonly<{
  names: ReadonlyMap<ZodSymbol, RecursiveDeclarationTypeNames>;
  statements: readonly Statement[];
}>;

type ValueTypeContext = Readonly<{
  recursiveNames: ReadonlyMap<ZodSymbol, RecursiveDeclarationTypeNames>;
  schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}>;

type ValueTypeRequest = Readonly<{
  context: ValueTypeContext;
  expression: SourceExpression;
  projection: TypeProjection;
}>;

type FactoryValueTypeRequest = Readonly<{
  context: ValueTypeContext;
  expression: SourceFactoryExpression;
  projection: TypeProjection;
}>;

type ValueTypeProjector = (request: ValueTypeRequest) => TypeNode;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected recursive source type node: ${JSON.stringify(value)}`);
};

const namedType = (name: string): TypeNode => createTypeReferenceNode(createIdentifier(name));

const unionType = (types: readonly TypeNode[]): TypeNode =>
  types.length === 1 && types[0] !== undefined ? types[0] : createUnionTypeNode(types);

const literalKeywordKind = (
  value: boolean | null,
): SyntaxKind.FalseKeyword | SyntaxKind.NullKeyword | SyntaxKind.TrueKeyword => {
  if (value === null) return SyntaxKind.NullKeyword;
  return value ? SyntaxKind.TrueKeyword : SyntaxKind.FalseKeyword;
};

const literalType = (value: ZodLiteralValue): TypeNode => {
  if (typeof value === "string")
    return createLiteralTypeNode(createStringLiteral(value, noTokenFlags));
  if (typeof value === "number")
    return createLiteralTypeNode(createNumericLiteral(String(value), noTokenFlags));
  return createLiteralTypeNode(createKeywordExpression(literalKeywordKind(value)));
};

const propertyName = (key: string): PropertyName =>
  isTypeScriptIdentifier(key) ? createIdentifier(key) : createStringLiteral(key, noTokenFlags);

const expressionArgument = (argument: SourceArgument | undefined): SourceExpression | undefined =>
  argument?.kind === "expression" ? argument.expression : undefined;

const arrayElements = (argument: SourceArgument | undefined): readonly SourceArgument[] =>
  argument?.kind === "array" ? argument.elements : [];

const literalArguments = (argument: SourceArgument | undefined): readonly ZodLiteralValue[] =>
  arrayElements(argument).flatMap((element) => (element.kind === "literal" ? [element.value] : []));

const optionalCall = (calls: readonly SourceMethodCall[]): boolean =>
  calls.some((call) => call.method === "optional");

const requiredKeys = (calls: readonly SourceMethodCall[]): ReadonlySet<string> =>
  new Set(
    calls.flatMap((call) =>
      call.method === "required"
        ? literalArguments(call.args[0]).flatMap((value) =>
            typeof value === "string" ? [value] : [],
          )
        : [],
    ),
  );

const applyValueCalls = (type: TypeNode, calls: readonly SourceMethodCall[]): TypeNode => {
  const variants = [type];
  if (calls.some((call) => call.method === "optional"))
    variants.push(createKeywordTypeNode(SyntaxKind.UndefinedKeyword));
  if (calls.some((call) => call.method === "nullable"))
    variants.push(createLiteralTypeNode(createKeywordExpression(SyntaxKind.NullKeyword)));
  return unionType(variants);
};

const referenceValueType = (
  expression: SourceReferenceExpression,
  projection: TypeProjection,
  context: ValueTypeContext,
): TypeNode => {
  const referencedProjection = expression.view === "schema" ? projection : expression.view;
  const recursiveNames = context.recursiveNames.get(expression.symbol);
  const base =
    recursiveNames === undefined
      ? zodType(referencedProjection, [
          createTypeQueryNode(
            createIdentifier(context.schemaConstNames.get(expression.symbol) ?? expression.symbol),
          ),
        ])
      : namedType(recursiveNames[referencedProjection]);
  return applyValueCalls(base, expression.calls);
};

const objectConfigValueType = (
  objectType: TypeNode,
  project: ValueTypeProjector,
  request: FactoryValueTypeRequest,
): TypeNode => {
  const { expression } = request;
  let additionalValue: TypeNode | undefined = undefined;
  for (const call of expression.calls)
    if (call.method === "strict") additionalValue = undefined;
    else if (call.method === "passthrough")
      additionalValue = createKeywordTypeNode(SyntaxKind.UnknownKeyword);
    else if (call.method === "catchall") {
      const catchall = expressionArgument(call.args[0]);
      if (catchall !== undefined) additionalValue = project({ ...request, expression: catchall });
    }
  return additionalValue === undefined
    ? objectType
    : createIntersectionTypeNode([
        objectType,
        createTypeReferenceNode(createIdentifier("Record"), [
          createKeywordTypeNode(SyntaxKind.StringKeyword),
          additionalValue,
        ]),
      ]);
};

const objectValueType = (
  project: ValueTypeProjector,
  request: FactoryValueTypeRequest,
): TypeNode => {
  const { expression } = request;
  const [shape] = expression.args;
  const properties = shape?.kind === "object" ? shape.properties : [];
  const required = requiredKeys(expression.calls);
  const members: TypeElement[] = properties.map((property) => {
    const optional = optionalCall(property.expression.calls) && !required.has(property.key);
    const type = project({ ...request, expression: property.expression });
    return createPropertySignatureDeclaration(
      undefined,
      propertyName(property.key),
      optional ? createToken(SyntaxKind.QuestionToken) : undefined,
      required.has(property.key)
        ? createTypeReferenceNode(createIdentifier("Exclude"), [
            type,
            createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
          ])
        : type,
      createIdentifier("undefined"),
    );
  });
  const configured = objectConfigValueType(createTypeLiteralNode(members), project, request);
  return applyValueCalls(configured, expression.calls);
};

const factoryValueType = (
  request: FactoryValueTypeRequest,
  project: ValueTypeProjector,
): TypeNode => {
  const { expression } = request;
  const nested = (argument: SourceArgument | undefined): TypeNode => {
    const child = expressionArgument(argument);
    return child === undefined
      ? createKeywordTypeNode(SyntaxKind.UnknownKeyword)
      : project({ ...request, expression: child });
  };
  const applyCalls = (type: TypeNode): TypeNode => applyValueCalls(type, expression.calls);
  switch (expression.factory) {
    case "array": {
      return applyCalls(createArrayTypeNode(nested(expression.args[0])));
    }
    case "boolean": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.BooleanKeyword));
    }
    case "enum": {
      return applyCalls(
        unionType(literalArguments(expression.args[0]).map((value) => literalType(value))),
      );
    }
    case "intersection": {
      return applyCalls(
        createIntersectionTypeNode([nested(expression.args[0]), nested(expression.args[1])]),
      );
    }
    case "literal": {
      const [argument] = expression.args;
      return applyCalls(
        argument?.kind === "literal"
          ? literalType(argument.value)
          : createKeywordTypeNode(SyntaxKind.UnknownKeyword),
      );
    }
    case "never": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.NeverKeyword));
    }
    case "null": {
      return applyCalls(createLiteralTypeNode(createKeywordExpression(SyntaxKind.NullKeyword)));
    }
    case "number": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.NumberKeyword));
    }
    case "object": {
      return objectValueType(project, request);
    }
    case "record": {
      return applyCalls(
        createTypeReferenceNode(createIdentifier("Record"), [
          nested(expression.args[0]),
          nested(expression.args[1]),
        ]),
      );
    }
    case "string": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.StringKeyword));
    }
    case "tuple": {
      return applyCalls(
        createTupleTypeNode(arrayElements(expression.args[0]).map((argument) => nested(argument))),
      );
    }
    case "union": {
      return applyCalls(
        unionType(arrayElements(expression.args[0]).map((argument) => nested(argument))),
      );
    }
    case "unknown": {
      return applyCalls(createKeywordTypeNode(SyntaxKind.UnknownKeyword));
    }
    case "xor": {
      return applyCalls(
        unionType(arrayElements(expression.args[0]).map((argument) => nested(argument))),
      );
    }
    default: {
      return assertNever(expression.factory);
    }
  }
};

const valueType: ValueTypeProjector = (request) => {
  const { context, expression, projection } = request;
  switch (expression.kind) {
    case "codec": {
      const projectedExpression = projection === "input" ? expression.input : expression.output;
      return applyValueCalls(
        valueType({ ...request, expression: projectedExpression }),
        expression.calls,
      );
    }
    case "factory": {
      return factoryValueType({ ...request, expression }, valueType);
    }
    case "reference": {
      return referenceValueType(expression, projection, context);
    }
    case "runtime-guard": {
      const projected = expression.parseStructural ? projection : "output";
      return applyValueCalls(
        valueType({ ...request, expression: expression.expression, projection: projected }),
        expression.calls,
      );
    }
    case "wrapper": {
      return applyValueCalls(
        valueType({ ...request, expression: expression.expression, projection: "input" }),
        expression.calls,
      );
    }
    default: {
      return assertNever(expression);
    }
  }
};

const recursiveSchemaType = (
  expression: SourceExpression,
  names: RecursiveDeclarationTypeNames,
): TypeNode =>
  expression.kind === "codec"
    ? zodType("ZodCodec", [
        zodType("ZodType", [
          createKeywordTypeNode(SyntaxKind.UnknownKeyword),
          namedType(names.input),
        ]),
        zodType("ZodType", [namedType(names.output), namedType(names.output)]),
      ])
    : zodType("ZodType", [namedType(names.output), namedType(names.input)]);

const allocateRecursiveNames = (
  symbols: readonly ZodSymbol[],
  schemaConstNames: ReadonlyMap<ZodSymbol, string>,
  allocator: TypeScriptIdentifierAllocator,
): ReadonlyMap<ZodSymbol, RecursiveDeclarationTypeNames> =>
  new Map(
    symbols.map((symbol) => {
      const schemaName = schemaConstNames.get(symbol) ?? symbol;
      return [
        symbol,
        {
          input: allocator.allocate(`${schemaName}Input`),
          output: allocator.allocate(`${schemaName}Output`),
          schema: allocator.allocate(`${schemaName}RecursiveType`),
        },
      ] as const;
    }),
  );

export const createRecursiveDeclarationTypes = (input: {
  readonly allocator: TypeScriptIdentifierAllocator;
  readonly cyclicSymbols: readonly ZodSymbol[];
  readonly module: SourceEmissionModule;
  readonly schemaConstNames: ReadonlyMap<ZodSymbol, string>;
}): RecursiveDeclarationTypes => {
  const declarations = new Map(
    input.module.declarations.map((declaration) => [declaration.symbol, declaration.expression]),
  );
  const names = allocateRecursiveNames(
    input.cyclicSymbols,
    input.schemaConstNames,
    input.allocator,
  );
  const context: ValueTypeContext = {
    recursiveNames: names,
    schemaConstNames: input.schemaConstNames,
  };
  const statements: Statement[] = [];
  for (const symbol of input.cyclicSymbols) {
    const expression = declarations.get(symbol);
    const declarationNames = names.get(symbol);
    if (expression !== undefined && declarationNames !== undefined)
      statements.push(
        createTypeAliasDeclaration(
          undefined,
          createIdentifier(declarationNames.input),
          undefined,
          valueType({ context, expression, projection: "input" }),
        ),
        createTypeAliasDeclaration(
          undefined,
          createIdentifier(declarationNames.output),
          undefined,
          valueType({ context, expression, projection: "output" }),
        ),
        createTypeAliasDeclaration(
          undefined,
          createIdentifier(declarationNames.schema),
          undefined,
          recursiveSchemaType(expression, declarationNames),
        ),
      );
  }
  return { names, statements };
};

export const recursiveSchemaAnnotation = (
  symbol: ZodSymbol,
  names: ReadonlyMap<ZodSymbol, RecursiveDeclarationTypeNames>,
): TypeNode | undefined => {
  const declarationNames = names.get(symbol);
  return declarationNames === undefined ? undefined : namedType(declarationNames.schema);
};

export const recursiveReferenceAnnotation = (
  expression: SourceReferenceExpression,
  names: ReadonlyMap<ZodSymbol, RecursiveDeclarationTypeNames>,
): TypeNode | undefined => {
  const declarationNames = names.get(expression.symbol);
  if (declarationNames === undefined) return undefined;
  if (expression.view === "schema") return namedType(declarationNames.schema);
  const projectedName = declarationNames[expression.view];
  return zodType("ZodType", [namedType(projectedName), namedType(projectedName)]);
};

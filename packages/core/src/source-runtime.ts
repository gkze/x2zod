import { NodeFlags, SyntaxKind } from "@typescript/native-preview/unstable/ast";
import type {
  Expression,
  Statement,
  TypeNode,
  VariableStatement,
} from "@typescript/native-preview/unstable/ast";
import {
  createArrowFunction,
  createCallExpression,
  createFunctionTypeNode,
  createIdentifier,
  createKeywordTypeNode,
  createStringLiteral,
  createToken,
  createTypeAliasDeclaration,
  createTypeParameterDeclaration,
  createTypeReferenceNode,
} from "@typescript/native-preview/unstable/ast/factory";

import type { ZodRuntimeProgram, ZodRuntimeProgramId } from "./runtime-program";
import {
  createSourceArrowParameter as createArrowParameter,
  createSourceConstStatement as createConstStatement,
  createSourceFunctionCall as createFunctionCall,
  createSourcePropertyAccess as createPropertyAccess,
  createSourceZodType as zodType,
} from "./source-ast";
import type { SourceRuntimeGuardExpression } from "./source-model";
import { compareCodeUnits } from "./string-order";
import type { TypeScriptIdentifierAllocator } from "./typescript-identifiers";
import type { ZodEmissionModule } from "./zod-plan";

const noTokenFlags = 0;
const runtimePredicateTypeName = "X2zodRuntimePredicate";
const runtimePredicateHelperName = "x2zodApplyRuntimePredicate";
const encodedRuntimePredicateTypeName = "X2zodEncodedRuntimePredicate";
const encodedRuntimePredicateHelperName = "x2zodApplyEncodedRuntimePredicate";
const runtimeProgramNamePrefix = "x2zodRuntimeProgram";

type RuntimeProgramEmission = Readonly<{
  names: ReadonlyMap<ZodRuntimeProgramId, string>;
  programs: readonly ZodRuntimeProgram[];
}>;

export const runtimePredicateHelperNames = (
  parseModes: ReadonlySet<boolean>,
): readonly string[] => [
  ...(parseModes.has(false) ? [runtimePredicateHelperName, runtimePredicateTypeName] : []),
  ...(parseModes.has(true)
    ? [encodedRuntimePredicateHelperName, encodedRuntimePredicateTypeName]
    : []),
];

const createRuntimePredicateType = (): TypeNode =>
  createFunctionTypeNode(
    undefined,
    [createArrowParameter("value", createKeywordTypeNode(SyntaxKind.UnknownKeyword))],
    createKeywordTypeNode(SyntaxKind.BooleanKeyword),
  );

const zodTypeProjection = (projection: "infer" | "input", schemaType: TypeNode): TypeNode =>
  zodType(projection, [schemaType]);

const createRuntimePredicateHelper = (parseStructural: boolean): VariableStatement => {
  const schemaType = createIdentifier("TSchema");
  const schemaTypeReference = createTypeReferenceNode(schemaType);
  const schema = createIdentifier("schema");
  const predicate = createIdentifier("predicate");
  const predicateType = createRuntimePredicateType();
  const custom = createCallExpression(
    createPropertyAccess(createIdentifier("z"), "custom"),
    undefined,
    [zodTypeProjection(parseStructural ? "input" : "infer", schemaTypeReference)],
    [predicate, createStringLiteral("Input does not satisfy the source schema.", noTokenFlags)],
    NodeFlags.None,
  );
  const result = parseStructural
    ? createFunctionCall(createPropertyAccess(custom, "pipe"), [schema])
    : custom;
  const helper = createArrowFunction(
    undefined,
    [
      createTypeParameterDeclaration(
        undefined,
        schemaType,
        parseStructural
          ? zodType("ZodType", [
              createKeywordTypeNode(SyntaxKind.UnknownKeyword),
              zodTypeProjection("input", schemaTypeReference),
            ])
          : zodType("ZodType"),
      ),
    ],
    [
      createArrowParameter(parseStructural ? "schema" : "_schema", schemaTypeReference),
      createArrowParameter("predicate", predicateType),
    ],
    createTypeReferenceNode(
      createIdentifier(
        parseStructural ? encodedRuntimePredicateTypeName : runtimePredicateTypeName,
      ),
      [schemaTypeReference],
    ),
    createToken(SyntaxKind.EqualsGreaterThanToken),
    result,
  );

  return createConstStatement(
    parseStructural ? encodedRuntimePredicateHelperName : runtimePredicateHelperName,
    helper,
  );
};

export const createRuntimePredicateHelperStatements = (
  parseModes: ReadonlySet<boolean>,
): readonly Statement[] => {
  const statements: Statement[] = [];
  if (parseModes.has(false)) {
    const schemaType = createTypeReferenceNode(createIdentifier("TSchema"));
    const outputType = zodTypeProjection("infer", schemaType);
    statements.push(
      createTypeAliasDeclaration(
        undefined,
        createIdentifier(runtimePredicateTypeName),
        [
          createTypeParameterDeclaration(
            undefined,
            createIdentifier("TSchema"),
            zodType("ZodType"),
          ),
        ],
        zodType("ZodCustom", [outputType, outputType]),
      ),
      createRuntimePredicateHelper(false),
    );
  }
  if (parseModes.has(true)) {
    const schemaType = createTypeReferenceNode(createIdentifier("TSchema"));
    const inputType = zodTypeProjection("input", schemaType);
    statements.push(
      createTypeAliasDeclaration(
        undefined,
        createIdentifier(encodedRuntimePredicateTypeName),
        [
          createTypeParameterDeclaration(
            undefined,
            createIdentifier("TSchema"),
            zodType("ZodType"),
          ),
        ],
        zodType("ZodPipe", [zodType("ZodCustom", [inputType, inputType]), schemaType]),
      ),
      createRuntimePredicateHelper(true),
    );
  }
  return statements;
};

export const createRuntimeProgramStatement = (
  name: string,
  program: ZodRuntimeProgram,
): VariableStatement =>
  createConstStatement(name, program.expression, createRuntimePredicateType());

export const resolveRuntimeProgramEmission = (
  module: ZodEmissionModule,
  identifierAllocator: TypeScriptIdentifierAllocator,
): RuntimeProgramEmission => {
  const names = new Map<ZodRuntimeProgramId, string>();
  const programs = module.runtimePrograms.toSorted((left, right) =>
    compareCodeUnits(left.id, right.id),
  );

  for (const [index, program] of programs.entries()) {
    const name = identifierAllocator.allocate(`${runtimeProgramNamePrefix}${index.toString()}`);
    names.set(program.id, name);
  }

  return { names, programs };
};

export const createRuntimeGuardExpression = (
  expression: SourceRuntimeGuardExpression,
  structural: Expression,
  programName: string,
): Expression =>
  createFunctionCall(
    createIdentifier(
      expression.parseStructural ? encodedRuntimePredicateHelperName : runtimePredicateHelperName,
    ),
    [structural, createIdentifier(programName)],
  );

export { sharedHelperStatements, sharedRuntimePrograms } from "./source-shared";

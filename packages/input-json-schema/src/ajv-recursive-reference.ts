import type { Code } from "ajv/dist/compile/codegen/index.js";
import { resolveRef, SchemaEnv } from "ajv/dist/compile/index.js";
import type { KeywordCxt } from "ajv/dist/compile/validate/index.js";
import type AjvCore from "ajv/dist/core.js";
import type { CodeKeywordDefinition } from "ajv/dist/types/index.js";
import { callRef, getValidate } from "ajv/dist/vocabularies/core/ref.js";

import {
  callAjvReferenceValidation as callValidation,
  ownAjvDynamicAnchorTarget,
} from "./ajv-reference-codegen";
import { isJsonObject } from "./document";
import { jsonSchemaKeywords } from "./metadata";

type StaticReferenceTarget = Readonly<{ environment: SchemaEnv; validate: Code }>;
type ExactRecursiveReference = Readonly<{
  documentPointer?: boolean | undefined;
  reference: string;
}>;

const recursiveReference = "#";

const isRecursiveReferenceObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const staticReferenceTarget = (
  context: KeywordCxt,
  { documentPointer, reference }: ExactRecursiveReference,
): StaticReferenceTarget => {
  const { baseId, schemaEnv, self, validateName } = context.it;
  const referenceBaseId = documentPointer === true ? schemaEnv.root.baseId : baseId;
  const target = resolveRef.call(self, schemaEnv.root, referenceBaseId, reference);
  if (!(target instanceof SchemaEnv))
    throw new Error("Cannot resolve the initial recursive-reference resource.");
  return {
    environment: target,
    validate: target === schemaEnv ? validateName : getValidate(context, target),
  };
};

const targetEnablesRecursiveResolution = (target: SchemaEnv): boolean =>
  isJsonObject(target.schema) && target.schema[jsonSchemaKeywords.recursiveAnchor] === true;

const compileExactRecursiveReference = (
  context: KeywordCxt,
  reference: ExactRecursiveReference,
): void => {
  const { gen, it } = context;
  const target = staticReferenceTarget(context, reference);
  if (!targetEnablesRecursiveResolution(target.environment)) {
    callRef(context, target.validate, target.environment, target.environment.$async);
    return;
  }

  const runtimeTarget = gen.let("_v", ownAjvDynamicAnchorTarget(""));
  if (it.allErrors === true)
    gen.if(
      runtimeTarget,
      callValidation(context, { validate: runtimeTarget }),
      callValidation(context, { target: target.environment, validate: target.validate }),
    );
  else {
    const valid = gen.let("valid", false);
    gen.if(
      runtimeTarget,
      callValidation(context, { valid, validate: runtimeTarget }),
      callValidation(context, { target: target.environment, valid, validate: target.validate }),
    );
    context.ok(valid);
  }
};

const readExactRecursiveReference = (schema: unknown): ExactRecursiveReference => {
  if (schema === recursiveReference) return { reference: recursiveReference };
  if (!isRecursiveReferenceObject(schema) || typeof schema["reference"] !== "string")
    throw new Error('Draft 2019-09 only defines "$recursiveRef" for the value "#".');
  const { documentPointer, reference } = schema;
  if (documentPointer !== undefined && typeof documentPointer !== "boolean")
    throw new Error("Invalid recursive reference document pointer marker.");
  return documentPointer === undefined ? { reference } : { documentPointer, reference };
};

const exactRecursiveReferenceDefinition: CodeKeywordDefinition = {
  code: (context): void => {
    compileExactRecursiveReference(context, readExactRecursiveReference(context.schema));
  },
  keyword: jsonSchemaKeywords.recursiveRef,
  schemaType: ["object", "string"],
};

export const installExactRecursiveReference = (ajv: AjvCore): void => {
  ajv.removeKeyword(jsonSchemaKeywords.recursiveRef);
  ajv.addKeyword(exactRecursiveReferenceDefinition);
};

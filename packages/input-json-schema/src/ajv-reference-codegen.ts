import { _, getProperty, Name, stringify } from "ajv/dist/compile/codegen/index.js";
import type { Code } from "ajv/dist/compile/codegen/index.js";
import type { SchemaEnv } from "ajv/dist/compile/index.js";
import type { KeywordCxt } from "ajv/dist/compile/validate/index.js";
import { callRef } from "ajv/dist/vocabularies/core/ref.js";

export const ajvDynamicAnchors: Name = new Name("dynamicAnchors");

export const ownAjvDynamicAnchorTarget = (anchor: string): Code =>
  _`(Object.hasOwn(${ajvDynamicAnchors}, ${stringify(anchor)}) ? ${ajvDynamicAnchors}${getProperty(anchor)} : undefined)`;

export const callAjvReferenceValidation = (
  context: KeywordCxt,
  request: Readonly<{ target?: SchemaEnv; valid?: Name; validate: Code }>,
): (() => void) => {
  const { valid } = request;
  return valid === undefined
    ? (): void => {
        callRef(context, request.validate, request.target, request.target?.$async);
      }
    : (): void => {
        context.gen.block(() => {
          callRef(context, request.validate, request.target, request.target?.$async);
          context.gen.assign(valid, true);
        });
      };
};

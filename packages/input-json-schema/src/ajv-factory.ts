import AjvDraft7 from "ajv";
import type { Options } from "ajv";
import AjvDraft2019 from "ajv/dist/2019.js";
import AjvDraft2020 from "ajv/dist/2020.js";

import type { JsonSchemaDialect } from "./options";

export type JsonSchemaAjv = AjvDraft7 | AjvDraft2019 | AjvDraft2020;

export const createJsonSchemaAjv = (
  dialect: JsonSchemaDialect,
  options: Options,
): JsonSchemaAjv => {
  if (dialect === "draft-2020-12") return new AjvDraft2020(options);
  if (dialect === "draft-2019-09") return new AjvDraft2019(options);
  return new AjvDraft7(options);
};

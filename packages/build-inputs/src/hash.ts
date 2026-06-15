import { createHash } from "node:crypto";

import { sha256HexSchema } from "./schemas";
import type { Sha256Hex } from "./schemas";

export const sha256Hex = (content: string): Sha256Hex =>
  sha256HexSchema.parse(createHash("sha256").update(content, "utf8").digest("hex"));

export const sha256HexBytes = (content: Buffer): Sha256Hex =>
  sha256HexSchema.parse(createHash("sha256").update(content).digest("hex"));

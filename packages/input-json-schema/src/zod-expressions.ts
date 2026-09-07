import { zodPlan } from "@x2zod/core";
import type { ZodExpression } from "@x2zod/core";

export const oneOrUnion = (expressions: readonly ZodExpression[]): ZodExpression => {
  const [first, second, ...remaining] = expressions;
  if (first === undefined) return zodPlan.never();
  return second === undefined ? first : zodPlan.union([first, second, ...remaining]);
};

export const oneOrIntersection = (expressions: readonly ZodExpression[]): ZodExpression => {
  const [first] = expressions;
  if (first === undefined) return zodPlan.unknown();
  if (expressions.length === 1) return first;
  // Balanced composition keeps TypeScript instantiation depth logarithmic in branch count.
  const middle = Math.floor(expressions.length / 2);
  return zodPlan.intersection(
    oneOrIntersection(expressions.slice(0, middle)),
    oneOrIntersection(expressions.slice(middle)),
  );
};

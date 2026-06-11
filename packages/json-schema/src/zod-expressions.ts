import { zodPlan } from "@x2zod/core";
import type { ZodExpression } from "@x2zod/core";

export const oneOrUnion = (expressions: readonly ZodExpression[]): ZodExpression => {
  const [first, second, ...remaining] = expressions;
  if (first === undefined) return zodPlan.never();
  return second === undefined ? first : zodPlan.union([first, second, ...remaining]);
};

export const oneOrIntersection = (expressions: readonly ZodExpression[]): ZodExpression => {
  const [first, second, ...remaining] = expressions;
  if (first === undefined) return zodPlan.unknown();
  let intersection = second === undefined ? first : zodPlan.intersection(first, second);
  for (const expression of remaining) intersection = zodPlan.intersection(intersection, expression);

  return intersection;
};

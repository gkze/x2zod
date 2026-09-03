import type { ZodArgument, ZodExpression, ZodMethodCall } from "./zod-plan";

type ZodArgumentVisitContext = Readonly<{
  call?: ZodMethodCall | undefined;
  expression: ZodExpression;
}>;
type ZodPlanVisitor = Readonly<{
  argument?:
    | ((argument: ZodArgument, context: ZodArgumentVisitContext) => boolean | "skip")
    | undefined;
  expression?: ((expression: ZodExpression) => boolean | "skip") | undefined;
  siblingOrder?: "forward" | "reverse" | undefined;
}>;
type ZodPlanVisit =
  | Readonly<{ argument: ZodArgument; context: ZodArgumentVisitContext; kind: "argument" }>
  | Readonly<{ expression: ZodExpression; kind: "expression" }>;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Zod IR node: ${JSON.stringify(value)}`);
};

const stackOrder = <T>(values: readonly T[], reverse: boolean): readonly T[] =>
  reverse ? values : values.toReversed();

export const walkZodExpression = (root: ZodExpression, visitor: ZodPlanVisitor): boolean => {
  const pending: ZodPlanVisit[] = [{ expression: root, kind: "expression" }];
  const reverseSiblings = visitor.siblingOrder === "reverse";
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) break;
    if (item.kind === "argument") {
      const { argument, context } = item;
      const result = visitor.argument?.(argument, context);
      if (result === true) return true;
      if (result !== "skip")
        switch (argument.kind) {
          case "array": {
            pending.push(
              ...stackOrder(argument.elements, reverseSiblings).map(
                (element): ZodPlanVisit => ({ argument: element, context, kind: "argument" }),
              ),
            );
            break;
          }
          case "expression": {
            pending.push({ expression: argument.expression, kind: "expression" });
            break;
          }
          case "helper":
          case "literal": {
            break;
          }
          case "object": {
            pending.push(
              ...stackOrder(argument.properties, reverseSiblings).map(
                (property): ZodPlanVisit => ({
                  expression: property.expression,
                  kind: "expression",
                }),
              ),
            );
            break;
          }
          default: {
            return assertNever(argument);
          }
        }
    } else {
      const { expression } = item;
      const result = visitor.expression?.(expression);
      if (result === true) return true;
      if (result !== "skip") {
        for (const call of stackOrder(expression.calls, reverseSiblings))
          pending.push(
            ...stackOrder(call.args, reverseSiblings).map(
              (argument): ZodPlanVisit => ({
                argument,
                context: { call, expression },
                kind: "argument",
              }),
            ),
          );
        switch (expression.kind) {
          case "factory": {
            pending.push(
              ...stackOrder(expression.args, reverseSiblings).map(
                (argument): ZodPlanVisit => ({
                  argument,
                  context: { expression },
                  kind: "argument",
                }),
              ),
            );
            break;
          }
          case "reference": {
            break;
          }
          case "runtime-guard":
          case "wrapper": {
            pending.push({ expression: expression.expression, kind: "expression" });
            break;
          }
          default: {
            return assertNever(expression);
          }
        }
      }
    }
  }
  return false;
};

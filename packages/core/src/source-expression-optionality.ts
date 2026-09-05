import type { SourceArgument, SourceExpression } from "./source-model";
import type { ZodSymbol } from "./zod-plan";

type OptionalityRequest = Readonly<{
  expression: SourceExpression;
  projection: "input" | "output";
  context: Readonly<{ declarations: ReadonlyMap<ZodSymbol, SourceExpression> }>;
}>;
const expressionArgument = (argument: SourceArgument | undefined): SourceExpression | undefined =>
  argument?.kind === "expression" ? argument.expression : undefined;
const arrayElements = (argument: SourceArgument | undefined): readonly SourceArgument[] =>
  argument?.kind === "array" ? argument.elements : [];

export const optionalExpression = (
  request: OptionalityRequest,
  visiting: ReadonlySet<ZodSymbol> = new Set(),
): boolean => {
  const { expression, context, projection } = request;
  if (expression.calls.some((call) => call.method === "optional")) return true;
  const nested = (child: SourceExpression): boolean =>
    optionalExpression({ ...request, expression: child }, visiting);
  if (expression.kind === "reference") {
    if (visiting.has(expression.symbol)) return false;
    const declaration = context.declarations.get(expression.symbol);
    return (
      declaration !== undefined &&
      optionalExpression(
        {
          ...request,
          expression: declaration,
          projection: expression.view === "schema" ? projection : expression.view,
        },
        new Set([...visiting, expression.symbol]),
      )
    );
  }
  if (expression.kind === "codec")
    return nested(projection === "input" ? expression.input : expression.output);
  if (expression.kind === "runtime-guard")
    return expression.parseStructural && projection === "output" && nested(expression.expression);
  if (expression.kind === "wrapper") return false;
  if (expression.factory === "union" || expression.factory === "xor")
    return arrayElements(expression.args[0]).some((argument) => {
      const child = expressionArgument(argument);
      return child !== undefined && nested(child);
    });
  if (expression.factory === "intersection")
    return expression.args.every((argument) => {
      const child = expressionArgument(argument);
      return child !== undefined && nested(child);
    });
  return false;
};

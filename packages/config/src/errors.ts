export type X2ZodConfigPathSegment = string | number;

export type X2ZodConfigIssue = Readonly<{
  message: string;
  path: readonly X2ZodConfigPathSegment[];
}>;

export class X2ZodConfigError extends Error {
  public readonly issues: readonly X2ZodConfigIssue[];

  public constructor(issues: readonly X2ZodConfigIssue[]) {
    super(formatConfigErrorMessage(issues));
    this.name = "X2ZodConfigError";
    this.issues = issues;
  }
}

export const formatConfigIssuePath = (path: readonly X2ZodConfigPathSegment[]): string =>
  path.length === 0 ? "<root>" : path.map(String).join(".");

const formatConfigErrorMessage = (issues: readonly X2ZodConfigIssue[]): string => {
  if (issues.length === 0) return "Invalid x2zod config.";

  return [
    "Invalid x2zod config:",
    ...issues.map((issue) => `- ${formatConfigIssuePath(issue.path)}: ${issue.message}`),
  ].join("\n");
};

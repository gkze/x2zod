import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";

import { plugin } from "#index";
import { closeNativeServicesForTests } from "#source";

const fixtureFilename = fileURLToPath(new URL("fixture.ts", import.meta.url));
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" }, sourceType: "module" },
});
const compactArrowInvalidCode = [
  "export const demo = ",
  "(value: string): string => { return value; };",
].join("");
const compactArrowOutput = ["export const demo = ", "(value: string): string => value;"].join("");
const compactControlInvalidCode = ["if (ready) {", " return value; }"].join("");
const compactControlOutput = ["if (ready)", " return value;"].join("");
const compactMultilineControlInvalidCode = [
  "if (missing) {",
  "  throw new Error(",
  "    message,",
  "  );",
  "}",
  "",
].join("\n");
const compactMultilineControlOutput = [
  "if (missing)",
  "  throw new Error(",
  "    message,",
  "  );",
  "",
].join("\n");
const splitLineWidth = 44;
const longStringValue = ["abcdefghijklmnopqrstuvwxyz", "0123456789"].join("");
const splitInputLine = ['export const value: string = "', longStringValue, '";'].join("");
const fittingWidenedStringLine = 'const value: string = "abcdefg hij";';
const exactWidthWidenedStringLine = 'const value: string = "abcdefghijklmnopqrst"';
const splitOutputLines = [
  'export const value: string = ("abcdefghij" +',
  '  "klmnopqrstuvwxyz0123456789");',
  "",
];
const overloadedFunctionDeclaration = [
  "export {};",
  "function parse(value: string): string;",
  "function parse(value: string): string { return value; }",
  "",
].join("\n");
const missingRuleMessage = "Missing rule";

const getRule = (name: string): NonNullable<(typeof plugin.rules)[string]> => {
  const rule = plugin.rules[name];

  if (rule === undefined) throw new Error([missingRuleMessage, name].join(" "));

  return rule;
};

RuleTester.describe = (_name, run): void => {
  run();
};

RuleTester.it = test as RuleTester.ItFn;

tester.run("compact-arrow-returns", getRule("compact-arrow-returns"), {
  invalid: [
    {
      code: compactArrowInvalidCode,
      errors: [{ messageId: "compact" }],
      output: compactArrowOutput,
    },
  ],
  valid: [compactArrowOutput],
});

tester.run("compact-control-statements", getRule("compact-control-statements"), {
  invalid: [
    {
      code: compactControlInvalidCode,
      errors: [{ messageId: "compact" }],
      output: compactControlOutput,
    },
    {
      code: compactMultilineControlInvalidCode,
      errors: [{ messageId: "compact" }],
      output: compactMultilineControlOutput,
    },
  ],
  valid: [compactControlOutput],
});

tester.run("const-arrow-functions", getRule("const-arrow-functions"), {
  invalid: [
    {
      code: ["export {};", "function local(value: string): string { return value; }", ""].join(
        "\n",
      ),
      errors: [{ messageId: "convert" }],
      output: [
        "export {};",
        "const local = (value: string): string => { return value; };",
        "",
      ].join("\n"),
    },
  ],
  valid: [
    ["export {};", "const local = (value: string): string => { return value; };", ""].join("\n"),
    overloadedFunctionDeclaration,
  ],
});

tester.run("split-long-strings", getRule("split-long-strings"), {
  invalid: [
    {
      after: closeNativeServicesForTests,
      code: [splitInputLine, ""].join("\n"),
      errors: [{ messageId: "split" }],
      filename: fixtureFilename,
      options: [{ lineWidth: splitLineWidth }],
      output: splitOutputLines.join("\n"),
    },
  ],
  valid: [
    {
      after: closeNativeServicesForTests,
      code: [fittingWidenedStringLine, ""].join("\n"),
      filename: fixtureFilename,
      options: [{ lineWidth: splitLineWidth }],
    },
    {
      after: closeNativeServicesForTests,
      code: [exactWidthWidenedStringLine, ""].join("\n"),
      filename: fixtureFilename,
      options: [{ lineWidth: splitLineWidth }],
    },
    {
      after: closeNativeServicesForTests,
      code: ['export const value = "abcdefghijklmnopqrstuvwxyz0123456789";', ""].join("\n"),
      filename: fixtureFilename,
      options: [{ lineWidth: splitLineWidth }],
    },
  ],
});

// @ts-check

/**
 * @typedef {Readonly<{
 *   globs?: readonly string[];
 *   ignores?: readonly string[];
 *   config?: import("markdownlint").ConfigurationStrict;
 * }>} MarkdownlintCli2Config
 */

/** @satisfies {MarkdownlintCli2Config} */
const markdownlintCli2Config = {
  globs: [
    "**/*.md",
    "!**/.changeset/**",
    "!**/.dex/**",
    "!**/.direnv/**",
    "!**/.publish-tmp/**",
    "!**/.turbo/**",
    "!**/.cache/**",
    "!**/.tmp-x2zod-*/**",
    "!**/coverage/**",
    "!**/dist/**",
    "!**/node_modules/**",
  ],
  config: { default: true, MD013: { line_length: 100 }, MD024: { siblings_only: true } },
};

export default markdownlintCli2Config;

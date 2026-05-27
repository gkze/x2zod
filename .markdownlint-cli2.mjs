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
  globs: ["**/*.md", "!**/.direnv/**", "!**/coverage/**", "!**/dist/**", "!**/node_modules/**"],
  config: { default: true, MD013: false, MD024: { siblings_only: true } },
};

export default markdownlintCli2Config;

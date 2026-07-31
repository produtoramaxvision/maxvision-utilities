/**
 * The one version string for media-forge.
 *
 * There used to be five, maintained by hand and independently: this constant,
 * `package.json`, `.claude-plugin/plugin.json`, the CLI's `.version()` and the
 * `McpServer` name/version pair. They drifted, and the drift was not cosmetic —
 * **the Claude Code plugin installer reads `plugin.json`**, which sat at 0.1.1
 * while package.json moved through 0.2.5, 0.2.6, 0.2.7 and 0.2.8. Four releases
 * were published and none of them ever reached an installed plugin, because from
 * the installer's point of view the version had not changed. The marketplace
 * clone advancing to a new commit is NOT the same thing as the plugin updating.
 *
 * Everything that reports a version now imports this, and
 * `tests/unit/version-consistency.test.ts` fails when the JSON files disagree
 * with it. A bump is one edit here plus the JSON files that test names.
 */
export const MEDIA_FORGE_VERSION = '0.2.11' as const;

# Changesets

Use `bun run changeset` to describe package changes. Maintainers cut release commits with
`bun run release:version` or let the Publish workflow's Changesets Action open and update the
version PR on `main`. Merging the version PR runs registry publishing through the local npm and JSR
adapters in `bun run publish:packages`.

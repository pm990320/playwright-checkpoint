# Changelog

## [Unreleased]

### Features

* add per-test markdown article metadata overrides for title, description, and slug
* add markdown `requireExplicitStep` filtering for help-article generation
* add per-test markdown frontmatter overrides for external CMS mapping
* add multi-article markdown output with shared checkpoint references

## [0.3.0](https://github.com/pm990320/playwright-checkpoint/compare/v0.2.3...v0.3.0) (2026-04-03)


### Features

* add docs pipeline and example project ([34d1556](https://github.com/pm990320/playwright-checkpoint/commit/34d1556f997ade807d2fc38781af65fdc83df316))
* add html checkpoint reporting ([8c3e5ba](https://github.com/pm990320/playwright-checkpoint/commit/8c3e5baf890a152316fda0ec5a7b192e0f19f184))
* add report CLI and markdown reporter ([4d40dcb](https://github.com/pm990320/playwright-checkpoint/commit/4d40dcb90bf666dd50e628a8325c81c9a23810b7))
* implement MCP proxy server (playwright-checkpoint-iox) ([f0ba51e](https://github.com/pm990320/playwright-checkpoint/commit/f0ba51ea84b9d1e6c44343d5e4ef26d3ffa4f5e3))
* linting, test infra, and core types + collector/reporter interfaces ([18cd0cf](https://github.com/pm990320/playwright-checkpoint/commit/18cd0cf57d5f56bca44dc2c5985fa5a2a254696f))


### Bug Fixes

* add bun setup to publish job ([db25b01](https://github.com/pm990320/playwright-checkpoint/commit/db25b013440359088c5178da96223c3347173518))
* add bun setup to publish job ([7b52440](https://github.com/pm990320/playwright-checkpoint/commit/7b5244082599aacf76b5ff4d9b8086f4ddb96191))
* guard publish job with tag check instead of releases_created condition ([911d53f](https://github.com/pm990320/playwright-checkpoint/commit/911d53fd9dd00e2bb8697e48ac0c59c622b33eb2))
* guard publish job with tag existence check ([22a80ac](https://github.com/pm990320/playwright-checkpoint/commit/22a80ac4c772820784ae0e8498e054b494b32f29))
* use tag_name for checkout to fix npm publish ([608031d](https://github.com/pm990320/playwright-checkpoint/commit/608031d9a59835906ffceec69a71bb19d4e62d77))
* use tag_name output for checkout instead of github.ref ([92c0efe](https://github.com/pm990320/playwright-checkpoint/commit/92c0efeb32581d54573ee1f069f17ad9899e87f8))


### Miscellaneous

* align package metadata ([f07f0b7](https://github.com/pm990320/playwright-checkpoint/commit/f07f0b7d50f5cb3ca8cc6ed57f2f9fec73170c3f))
* integrate npm publish into release-please workflow ([d9fde06](https://github.com/pm990320/playwright-checkpoint/commit/d9fde062b9d3a23317e11bee6b4cf1c44fbfa16b))
* integrate npm publish into release-please workflow ([34446bf](https://github.com/pm990320/playwright-checkpoint/commit/34446bf1221d155c2af74919a72fc5fe70314855))
* **main:** release 0.2.0 ([#2](https://github.com/pm990320/playwright-checkpoint/issues/2)) ([e926d40](https://github.com/pm990320/playwright-checkpoint/commit/e926d4086ce911497347c6dfa9930f0e1c1c01bb))
* **main:** release 0.2.1 ([d616c66](https://github.com/pm990320/playwright-checkpoint/commit/d616c66f49aaeb78cbba45c4527145fd30fb836c))
* **main:** release 0.2.1 ([d1b8259](https://github.com/pm990320/playwright-checkpoint/commit/d1b825941de6037de4a8934fbf95fecd21fa71e0))
* **main:** release 0.2.2 ([23d64a6](https://github.com/pm990320/playwright-checkpoint/commit/23d64a6214628e04df1f606f7e03be786b95f0e3))
* **main:** release 0.2.2 ([58594a0](https://github.com/pm990320/playwright-checkpoint/commit/58594a09e08a103ca6ba871053beaeafcd7bcf61))
* **main:** release 0.2.3 ([79524d5](https://github.com/pm990320/playwright-checkpoint/commit/79524d52da5786784eac5bab1da90c4df9b7941c))
* **main:** release 0.2.3 ([7fbea65](https://github.com/pm990320/playwright-checkpoint/commit/7fbea65e9324d319ec799f18db8c563c9546919a))
* scaffold playwright-checkpoint package ([d858830](https://github.com/pm990320/playwright-checkpoint/commit/d858830bf1fbaef93e89bc3341e3d418bd0a87d9))
* stop tracking .beads ([93835b6](https://github.com/pm990320/playwright-checkpoint/commit/93835b6b6850106c1e7bf286c8bb46e47752eafa))
* update repo references to pm990320/playwright-checkpoint ([f9aa55c](https://github.com/pm990320/playwright-checkpoint/commit/f9aa55c4ab2f837bad1bff07b75c98a61e6d1968))


### CI

* add example smoke test ([471ea45](https://github.com/pm990320/playwright-checkpoint/commit/471ea4583ee08ef7f6bb9ee0d181ae6752766403))
* add release-please and automated npm publishing ([3d8714c](https://github.com/pm990320/playwright-checkpoint/commit/3d8714cd45231fed76d6533e59315a64bee0faea))
* raise package size threshold ([7a51596](https://github.com/pm990320/playwright-checkpoint/commit/7a515969e6182a31ce1c4654e3306c64a786bc1a))

## [0.2.3](https://github.com/pm990320/playwright-checkpoint/compare/v0.2.2...v0.2.3) (2026-04-03)


### Bug Fixes

* add bun setup to publish job ([db25b01](https://github.com/pm990320/playwright-checkpoint/commit/db25b013440359088c5178da96223c3347173518))
* add bun setup to publish job ([7b52440](https://github.com/pm990320/playwright-checkpoint/commit/7b5244082599aacf76b5ff4d9b8086f4ddb96191))

## [0.2.2](https://github.com/pm990320/playwright-checkpoint/compare/v0.2.1...v0.2.2) (2026-04-03)


### Bug Fixes

* use tag_name for checkout to fix npm publish ([608031d](https://github.com/pm990320/playwright-checkpoint/commit/608031d9a59835906ffceec69a71bb19d4e62d77))
* use tag_name output for checkout instead of github.ref ([92c0efe](https://github.com/pm990320/playwright-checkpoint/commit/92c0efeb32581d54573ee1f069f17ad9899e87f8))

## [0.2.1](https://github.com/pm990320/playwright-checkpoint/compare/v0.2.0...v0.2.1) (2026-04-03)


### Bug Fixes

* guard publish job with tag check instead of releases_created condition ([911d53f](https://github.com/pm990320/playwright-checkpoint/commit/911d53fd9dd00e2bb8697e48ac0c59c622b33eb2))
* guard publish job with tag existence check ([22a80ac](https://github.com/pm990320/playwright-checkpoint/commit/22a80ac4c772820784ae0e8498e054b494b32f29))


### Miscellaneous

* integrate npm publish into release-please workflow ([d9fde06](https://github.com/pm990320/playwright-checkpoint/commit/d9fde062b9d3a23317e11bee6b4cf1c44fbfa16b))
* integrate npm publish into release-please workflow ([34446bf](https://github.com/pm990320/playwright-checkpoint/commit/34446bf1221d155c2af74919a72fc5fe70314855))

## [0.2.0](https://github.com/pm990320/playwright-checkpoint/compare/v0.1.0...v0.2.0) (2026-04-03)


### Features

* add docs pipeline and example project ([34d1556](https://github.com/pm990320/playwright-checkpoint/commit/34d1556f997ade807d2fc38781af65fdc83df316))
* add html checkpoint reporting ([8c3e5ba](https://github.com/pm990320/playwright-checkpoint/commit/8c3e5baf890a152316fda0ec5a7b192e0f19f184))
* add report CLI and markdown reporter ([4d40dcb](https://github.com/pm990320/playwright-checkpoint/commit/4d40dcb90bf666dd50e628a8325c81c9a23810b7))
* implement MCP proxy server (playwright-checkpoint-iox) ([f0ba51e](https://github.com/pm990320/playwright-checkpoint/commit/f0ba51ea84b9d1e6c44343d5e4ef26d3ffa4f5e3))
* linting, test infra, and core types + collector/reporter interfaces ([18cd0cf](https://github.com/pm990320/playwright-checkpoint/commit/18cd0cf57d5f56bca44dc2c5985fa5a2a254696f))


### Miscellaneous

* align package metadata ([f07f0b7](https://github.com/pm990320/playwright-checkpoint/commit/f07f0b7d50f5cb3ca8cc6ed57f2f9fec73170c3f))
* scaffold playwright-checkpoint package ([d858830](https://github.com/pm990320/playwright-checkpoint/commit/d858830bf1fbaef93e89bc3341e3d418bd0a87d9))
* stop tracking .beads ([93835b6](https://github.com/pm990320/playwright-checkpoint/commit/93835b6b6850106c1e7bf286c8bb46e47752eafa))
* update repo references to pm990320/playwright-checkpoint ([f9aa55c](https://github.com/pm990320/playwright-checkpoint/commit/f9aa55c4ab2f837bad1bff07b75c98a61e6d1968))


### CI

* add example smoke test ([471ea45](https://github.com/pm990320/playwright-checkpoint/commit/471ea4583ee08ef7f6bb9ee0d181ae6752766403))
* add release-please and automated npm publishing ([3d8714c](https://github.com/pm990320/playwright-checkpoint/commit/3d8714cd45231fed76d6533e59315a64bee0faea))
* raise package size threshold ([7a51596](https://github.com/pm990320/playwright-checkpoint/commit/7a515969e6182a31ce1c4654e3306c64a786bc1a))

## Changelog

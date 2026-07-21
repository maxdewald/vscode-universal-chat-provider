# Changelog

## [0.23.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.22.0...v0.23.0) (2026-07-21)


### Features

* add provider aliases for OpenAI-compatible models ([60a1f3d](https://github.com/maxdewald/vscode-universal-chat-provider/commit/60a1f3d386f934a5ae41372668b93ed21821aeb1))
* generate unique provider names for OpenAI-compatible endpoints ([412ae13](https://github.com/maxdewald/vscode-universal-chat-provider/commit/412ae13b7e25103e938d057293a35bb81d0ae46d))

## [0.22.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.21.0...v0.22.0) (2026-07-21)


### Features

* improve catalog model matching for model variants ([d7e531d](https://github.com/maxdewald/vscode-universal-chat-provider/commit/d7e531d5ab293282dd2446bacf7c49b3a17102f2))


### Documentation

* add OpenAI-compatible badge to README ([7d658ca](https://github.com/maxdewald/vscode-universal-chat-provider/commit/7d658ca1d12d51c44ead9b589d55f65d751b06a0))

## [0.21.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.20.1...v0.21.0) (2026-07-21)


### Features

* support OpenAI-compatible endpoints ([2db9b83](https://github.com/maxdewald/vscode-universal-chat-provider/commit/2db9b8301e2df8c3442f3efbd59a7be1bf1782b3))
* support Retry-After backoff for quota fetching ([69875e0](https://github.com/maxdewald/vscode-universal-chat-provider/commit/69875e03051285148302d290657cff9ba1cf8fa7))

## [0.20.1](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.20.0...v0.20.1) (2026-07-21)


### Bug Fixes

* render empty track in quota usage bar ([5198312](https://github.com/maxdewald/vscode-universal-chat-provider/commit/5198312c079cf4bfc42433aeadecb9127aa2f727))

## [0.20.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.19.4...v0.20.0) (2026-07-21)


### Features

* group quota sections by account ([4d6065f](https://github.com/maxdewald/vscode-universal-chat-provider/commit/4d6065fc332c3ff706d75a65b185e722ae94bff6))
* support multi-account quotas and improve login detection ([011a96a](https://github.com/maxdewald/vscode-universal-chat-provider/commit/011a96a8381850c70f5be4f4c1ef690bc84e54d5))


### Bug Fixes

* handle null codex rate limit windows ([def71e9](https://github.com/maxdewald/vscode-universal-chat-provider/commit/def71e9f7225e355187f51bf963691d555772a7e))


### Refactoring

* use TypeBox schemas for runtime validation ([56b7bb2](https://github.com/maxdewald/vscode-universal-chat-provider/commit/56b7bb27e5a02ea3384a30c6d25af4867efccab9))

## [0.19.4](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.19.3...v0.19.4) (2026-07-17)


### Bug Fixes

* claim quota reset after modal hides picker ([6d9571c](https://github.com/maxdewald/vscode-universal-chat-provider/commit/6d9571c17b001cb064195707f2e041c14fb9514d))

## [0.19.3](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.19.2...v0.19.3) (2026-07-15)


### Bug Fixes

* parse chatgpt_account_id from id_token ([b2f16ad](https://github.com/maxdewald/vscode-universal-chat-provider/commit/b2f16ad41ea0a8fd48075730a559ec55dc59b434))

## [0.19.2](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.19.1...v0.19.2) (2026-07-14)


### Bug Fixes

* refresh models after server settles ([e382c4e](https://github.com/maxdewald/vscode-universal-chat-provider/commit/e382c4efbeb29c8851d4a7df8de117e16015c468))


### Refactoring

* preserve narrow type inference ([4c3bfa7](https://github.com/maxdewald/vscode-universal-chat-provider/commit/4c3bfa7c3c0733e44b50abe43e17ff4331bc097e))

## [0.19.1](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.19.0...v0.19.1) (2026-07-14)


### Bug Fixes

* do not trigger credential recovery on 403 errors ([acf8737](https://github.com/maxdewald/vscode-universal-chat-provider/commit/acf8737cc09418b8a6e8808384cc1616dd077b22))
* localize reset expiration time ([24acca0](https://github.com/maxdewald/vscode-universal-chat-provider/commit/24acca0ca291e87e648ab3a0b26bba05b98167fb))
* publish VS Marketplace release from built vsix ([1df14c7](https://github.com/maxdewald/vscode-universal-chat-provider/commit/1df14c740cf947443f10408f3d00466eec07c299))

## [0.19.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.18.1...v0.19.0) (2026-07-14)


### Features

* publish releases to Open VSX ([777c7e8](https://github.com/maxdewald/vscode-universal-chat-provider/commit/777c7e84b2280372787d385494e7d14e91e90d9e))
* sync Explore with utility model ([b8b65fa](https://github.com/maxdewald/vscode-universal-chat-provider/commit/b8b65faf87ec70fb1f033c74320f889edd4daca8))


### Bug Fixes

* deduplicate model collision logs ([7c8c692](https://github.com/maxdewald/vscode-universal-chat-provider/commit/7c8c69242edd761177dde0d4a41e9672e9082c90))
* delay model refresh after server restart ([9f496ab](https://github.com/maxdewald/vscode-universal-chat-provider/commit/9f496abfde5d456016734ec84f09ed5bffb8d0b8))
* isolate cache prefix diagnostics ([ec9b25f](https://github.com/maxdewald/vscode-universal-chat-provider/commit/ec9b25f0c63997b77c5342228d93d2710feef1b8))
* make managed server restarts reliable ([7446ae4](https://github.com/maxdewald/vscode-universal-chat-provider/commit/7446ae47431cdbac5a32d8ea6bc31bad50459a07))

## [0.18.1](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.18.0...v0.18.1) (2026-07-14)


### Documentation

* simplify package description ([9314d32](https://github.com/maxdewald/vscode-universal-chat-provider/commit/9314d325165a97eedf497cc415fa3c4e5bf373dd))

## [0.18.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.17.3...v0.18.0) (2026-07-14)


### Features

* add Codex reset credit redemption in quota menu ([715b853](https://github.com/maxdewald/vscode-universal-chat-provider/commit/715b853f97ea0fe57e8806b4b4d649a937bc4464))


### Refactoring

* simplify configurations, quota fetching, and stream parsing ([a66a73f](https://github.com/maxdewald/vscode-universal-chat-provider/commit/a66a73f6d832453f97b14171b1777d6e9d888aa7))

## [0.17.3](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.17.2...v0.17.3) (2026-07-13)


### Bug Fixes

* **cliproxy:** sync config port when adopting server to prevent broken OAuth callbacks ([186406d](https://github.com/maxdewald/vscode-universal-chat-provider/commit/186406d9a664d5c289b209c8a90900dd14e4e740))
* preserve conflicting model aliases ([1946bd8](https://github.com/maxdewald/vscode-universal-chat-provider/commit/1946bd834e38f06a280c275960a98f463c5a33fd))


### Documentation

* add demo section with showcase image ([38f0d70](https://github.com/maxdewald/vscode-universal-chat-provider/commit/38f0d701177382d1b1c04240e10504d61c8d27cd))
* remove demo section description ([dda11cc](https://github.com/maxdewald/vscode-universal-chat-provider/commit/dda11cc60e77a9788fefd893e7158a110f9a4dec))

## [0.17.2](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.17.1...v0.17.2) (2026-07-13)


### Refactoring

* **status-bar:** show warning on crash and remove running tooltip ([bb9ec35](https://github.com/maxdewald/vscode-universal-chat-provider/commit/bb9ec3570aa8388abc02e3de3531e55f1345156d))

## [0.17.1](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.17.0...v0.17.1) (2026-07-13)


### Bug Fixes

* preserve model identity and system prompts ([d1c39b7](https://github.com/maxdewald/vscode-universal-chat-provider/commit/d1c39b73f774b327c1332de34d7463a57cf5c2fd))

## [0.17.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.16.0...v0.17.0) (2026-07-13)


### Features

* show quota resets in status tooltip ([4edd509](https://github.com/maxdewald/vscode-universal-chat-provider/commit/4edd509d2860aeaea1974ec689f55936c66650a3))


### Bug Fixes

* separate reasoning summary parts ([e2175dc](https://github.com/maxdewald/vscode-universal-chat-provider/commit/e2175dc6cae27267b4201e89cebe93f492a48607))


### Documentation

* update account load balancing description ([5657c6a](https://github.com/maxdewald/vscode-universal-chat-provider/commit/5657c6a944de22dc7b5d29f7ab0f48af13d30483))

## [0.16.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.15.0...v0.16.0) (2026-07-12)


### Features

* add Grok quota support with resetsAt countdowns ([3a9ac0c](https://github.com/maxdewald/vscode-universal-chat-provider/commit/3a9ac0ccbe2a886a284b77cd8f058284762cf69e))
* add reasoningSummary setting and default to detailed ([3d51715](https://github.com/maxdewald/vscode-universal-chat-provider/commit/3d517152efab48297d0b33b9b954651140fb477d))


### Refactoring

* drop unused ProxyStreamError structured error ([26e849b](https://github.com/maxdewald/vscode-universal-chat-provider/commit/26e849b3a5dc594cf8739bd1df10e74b8b03e607))
* extract sevenDayFamily helper in quota ([c706431](https://github.com/maxdewald/vscode-universal-chat-provider/commit/c706431b5176fc47ab46aac6ee19d2e0d9bcbec4))
* remove dead UsageContext label and requestInitiator fields ([afe10c7](https://github.com/maxdewald/vscode-universal-chat-provider/commit/afe10c7f421098a8874d476ea144d97b472de308))


### Documentation

* replace ascii diagram with visual assets ([d709eee](https://github.com/maxdewald/vscode-universal-chat-provider/commit/d709eee1fbda5985d6379e30999e3ea7be487d1a))

## [0.15.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.14.0...v0.15.0) (2026-07-12)


### Features

* improve quota resilience with retry logic and deduplication ([37f258a](https://github.com/maxdewald/vscode-universal-chat-provider/commit/37f258aa74bdc28712ad7122fb3022507d0ec13e))


### Documentation

* adjust spacing in readme ([9716d25](https://github.com/maxdewald/vscode-universal-chat-provider/commit/9716d25365d9ffd8ee645dd290b8675e1151d546))
* format features table in readme ([5e6e783](https://github.com/maxdewald/vscode-universal-chat-provider/commit/5e6e78366471e0699b5afa520d310ce727e405ae))
* restructure and simplify readme ([558aa45](https://github.com/maxdewald/vscode-universal-chat-provider/commit/558aa450a0b6540101c3f2a11fdaac53dea51fcc))

## [0.14.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.13.0...v0.14.0) (2026-07-11)


### Features

* add Claude quota tracking and migrate HTTP clients to ky ([187d6c7](https://github.com/maxdewald/vscode-universal-chat-provider/commit/187d6c7259871f9447bbec8ec983af8262dc55bd))
* replace update suggestion with 3-mode update policy ([87ce0e8](https://github.com/maxdewald/vscode-universal-chat-provider/commit/87ce0e8a0c99e4de5909c04b4df92bf8a09c0051))
* strip reasoning summary sentinels from streaming ([6c15277](https://github.com/maxdewald/vscode-universal-chat-provider/commit/6c152772f53873b3f2892af439e2b85322bd97aa))


### Refactoring

* deduplicate quota fetching logic ([ecc468a](https://github.com/maxdewald/vscode-universal-chat-provider/commit/ecc468a9d54738d3ffe54756303d7892b9259aab))
* use Map.groupBy and remove unused helpers ([dd11744](https://github.com/maxdewald/vscode-universal-chat-provider/commit/dd117447b94f1336f52bc7870b3a17609843b2e6))

## [0.13.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.12.0...v0.13.0) (2026-06-25)


### Features

* add low quota warning to status bar ([2f404a2](https://github.com/maxdewald/vscode-universal-chat-provider/commit/2f404a26234014894e328f42ccd9a082340e395b))
* show quota details in status bar tooltip ([d86d3ba](https://github.com/maxdewald/vscode-universal-chat-provider/commit/d86d3bac63aa99cfea8b81fce0485983067ea996))

## [0.12.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.11.0...v0.12.0) (2026-06-24)


### Features

* add model quota tracking ([5ab9f2e](https://github.com/maxdewald/vscode-universal-chat-provider/commit/5ab9f2eeb5d241f3c9a28a31954874ecf8b1bb1e))


### Bug Fixes

* update Antigravity badge and add CLIProxyAPI attribution ([97beb31](https://github.com/maxdewald/vscode-universal-chat-provider/commit/97beb31762e085810147fa389bda85584aec3cc6))

## [0.11.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.10.0...v0.11.0) (2026-06-22)


### Features

* preserve stream error metadata ([9d3d966](https://github.com/maxdewald/vscode-universal-chat-provider/commit/9d3d966fe5658588b6a1aee326c19d86f0e6020f))

## [0.10.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.9.0...v0.10.0) (2026-06-22)


### Features

* honor proxy default reasoning level, fall back to second-highest ([ffff853](https://github.com/maxdewald/vscode-universal-chat-provider/commit/ffff8538df65579c9e957d428c9316a0712990f8))


### Bug Fixes

* log cache diffs around divergence ([dc53d9b](https://github.com/maxdewald/vscode-universal-chat-provider/commit/dc53d9b3c93fc1ece5be5fbd3ce81d35ddd7393b))

## [0.9.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.8.3...v0.9.0) (2026-06-21)


### Features

* drop output-token fallback setting, skip models with no limit ([959ccd3](https://github.com/maxdewald/vscode-universal-chat-provider/commit/959ccd3c87db2b75c4bf80d9512eb21e650717e0))
* log and resolve model display name collisions ([423d2cd](https://github.com/maxdewald/vscode-universal-chat-provider/commit/423d2cdc1f02ce042ecd200e8c1d850e7095341b))
* support reasoning effort for utility models ([51571cc](https://github.com/maxdewald/vscode-universal-chat-provider/commit/51571cc9d90a6551036127cc42afe336aff48dd8))

## [0.8.3](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.8.2...v0.8.3) (2026-06-19)


### Bug Fixes

* moderndash startup crash because it was not bundled ([e01ad03](https://github.com/maxdewald/vscode-universal-chat-provider/commit/e01ad0320e273451ef2b207c03a5a6be2016a80c))

## [0.8.2](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.8.1...v0.8.2) (2026-06-19)


### Bug Fixes

* lockfile ([7bc0c46](https://github.com/maxdewald/vscode-universal-chat-provider/commit/7bc0c46af5686655b6ac803fbc744e0349c49238))

## [0.8.1](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.8.0...v0.8.1) (2026-06-19)


### Bug Fixes

* reasoning and thinking selectors brought back ([dd50d11](https://github.com/maxdewald/vscode-universal-chat-provider/commit/dd50d116375994d62aa3c19b1b9c079ab7b928e5))

## [0.8.0](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.7.4...v0.8.0) (2026-06-18)


### Features

* only use proposed apis and fix marketplace install ([26a14d7](https://github.com/maxdewald/vscode-universal-chat-provider/commit/26a14d73bfc6ad7eee6cb4c6695aa7ea497018e5))

## [0.7.4](https://github.com/maxdewald/vscode-universal-chat-provider/compare/v0.7.3...v0.7.4) (2026-06-18)


### Documentation

* add Kimi badge to README for visibility ([c11409e](https://github.com/maxdewald/vscode-universal-chat-provider/commit/c11409e7e490f5c9d40f0204fc413b0594e4d94e))
* clarify VS Code Copilot Chat positioning, fix retired badges ([387037e](https://github.com/maxdewald/vscode-universal-chat-provider/commit/387037e374ecc6da68b699df5914c3f12a81e570))
* update package description for clarity and detail ([587654d](https://github.com/maxdewald/vscode-universal-chat-provider/commit/587654d2d0f72b9500a1795a1fc9442b5b75a009))
* update README badges for consistency and clarity ([ba881d9](https://github.com/maxdewald/vscode-universal-chat-provider/commit/ba881d9a77648ce92478d6cb9a94f3be3cf523d4))
* update README for command formatting and clarity ([def1fef](https://github.com/maxdewald/vscode-universal-chat-provider/commit/def1fef8f40bc33fc9644a51a71886985cf51438))

## [0.7.3](https://github.com/maxdewald/universal-chat-provider/compare/v0.7.2...v0.7.3) (2026-06-18)


### Bug Fixes

* normalize tilde-expanded config paths on Windows ([b0ed2b9](https://github.com/maxdewald/universal-chat-provider/commit/b0ed2b951c233522958caee9efcac6a01d9a7cd1))


### Documentation

* update README for Marketplace launch ([cd91053](https://github.com/maxdewald/universal-chat-provider/commit/cd910533a92d23efccd230bfd80d5d837dc05b41))

## [0.7.2](https://github.com/maxdewald/universal-chat-provider/compare/v0.7.1...v0.7.2) (2026-06-17)


### Bug Fixes

* drop unused contribSourceControlInputBoxMenu proposed api ([6d8ca95](https://github.com/maxdewald/universal-chat-provider/commit/6d8ca95dd896a066bd28c627d75cc58c822f5a70))

## [0.7.1](https://github.com/maxdewald/universal-chat-provider/compare/universal-chat-provider-v0.7.0...universal-chat-provider-v0.7.1) (2026-06-17)


### Bug Fixes

* publish to marketplace with proposed apis allowed ([f17edee](https://github.com/maxdewald/universal-chat-provider/commit/f17edee0ab622b8b8f373e68012250f5788f2776))

## [0.7.0](https://github.com/maxdewald/universal-chat-provider/compare/universal-chat-provider-v0.6.0...universal-chat-provider-v0.7.0) (2026-06-17)


### Features

* add CLIProxyAPI model provider ([6236438](https://github.com/maxdewald/universal-chat-provider/commit/6236438b949ecdfd50204305d6327c2cf6e169b1))
* add new dependencies and refactor async handling with improved retry logic ([0882506](https://github.com/maxdewald/universal-chat-provider/commit/088250600900bc48ab7aeaab83f20f0dfaf3ab04))
* add prompt cache key and session affinity ([1f24de6](https://github.com/maxdewald/universal-chat-provider/commit/1f24de66f2b83f227fa4d3f63d1af96ff347a30c))
* add prompt cache metrics tracking and open settings command ([eab26a8](https://github.com/maxdewald/universal-chat-provider/commit/eab26a870b66f1f00afb48c1f12d6c47c8c4f359))
* add update suggestion feature and related tests ([906076e](https://github.com/maxdewald/universal-chat-provider/commit/906076ee12cdd76a50367a4bbce476382885ebdd))
* **chat:** introduce local token estimation and background caching ([480621b](https://github.com/maxdewald/universal-chat-provider/commit/480621b998b625a22fd3882e7c548554013a70ad))
* deduplicate reasoning models in mapping function and add corresponding test ([752cb28](https://github.com/maxdewald/universal-chat-provider/commit/752cb2860946c8000df33ccf9aad2f342437036e))
* improve commit message generation and server management UI ([a0c0650](https://github.com/maxdewald/universal-chat-provider/commit/a0c0650540c7d1e0bdbb319e420223805950f1d3))
* introduce managed server for CLIProxyAPI with health checks and port management; refactor provider to support universal chat; update tests and configurations accordingly ([9c1209a](https://github.com/maxdewald/universal-chat-provider/commit/9c1209aaafc369585ed662c27e26495fbe542201))
* **managed:** manage sidecar server lifecycle using window leases ([baa8537](https://github.com/maxdewald/universal-chat-provider/commit/baa85377f38e6017d3f130c22e6572ae4c5c97de))


### Bug Fixes

* **chat:** advertise full context window as maxInputTokens ([709b79b](https://github.com/maxdewald/universal-chat-provider/commit/709b79bce0d8c8baf4dcfa4d05dd13c0eab7a1ae))
* support VS Code 1.124 ([d5478fa](https://github.com/maxdewald/universal-chat-provider/commit/d5478fa3add5fc85c23b7ddf1345248d3700dcb1))


### Refactoring

* **chat:** use local token estimation instead of remote counting ([ef79f16](https://github.com/maxdewald/universal-chat-provider/commit/ef79f165e00e73bbb3fd54b29b44cad099e4cee1))
* enhance tooltip generation and improve model description handling ([0aece2b](https://github.com/maxdewald/universal-chat-provider/commit/0aece2bac4ee7f55cc2528312f5ef5a6334fd917))
* remove untildify dependency and update path handling for home directory expansion ([a8725c1](https://github.com/maxdewald/universal-chat-provider/commit/a8725c18a75e96180dcf4b5d87f55334dc33cb8a))
* resolve requested binary version dynamically ([9371ec9](https://github.com/maxdewald/universal-chat-provider/commit/9371ec9251f085619e2d415814e71887fac92e3c))
* simplify process exit tracking ([c7dd144](https://github.com/maxdewald/universal-chat-provider/commit/c7dd144e0c82242be1c2ce738cdfef8fc7e58e1c))
* update README to clarify utility model and remove commit messages section ([aa1ca96](https://github.com/maxdewald/universal-chat-provider/commit/aa1ca96beb783dc2a3f345f0f1133655d9e10f37))

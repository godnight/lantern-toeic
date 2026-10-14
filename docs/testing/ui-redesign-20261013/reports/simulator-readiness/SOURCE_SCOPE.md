Latest final proof: build-lantern-ui-v11-knsxbchb/final-freeze-proof.json, checked 2026-10-13 10:10:47 UTC: 1,229 input paths/hash values match current source; zero added/missing/changed, 1,071 resources byte-identical. See FINAL_NATIVE_RESULT.md. Historical references below remain archived.

# 最终候选的源集合边界

本规则用于下一次 root 明确冻结后的全新快照，不重新解释之前 HAP/proof 的历史输入。

核对 app、lib、components、hooks、types、vendor；内容数据和 public 资产；mobile 入口、构建脚本、配置与离线音频；Harmony 原生工程、构建配置和同步/包体核对脚本。根 package.json、package-lock.json、tsconfig.json、postcss.config.mjs、.gitignore、release-manifest.json 同时固定。

不选入根 README.md、docs、tests、reports；已选目录内的 .md/.txt 说明文档也不进入构建输入，Harmony 的 tests 与 scripts/ui 设备 runner/fixtures 排除。public 中实际随共享包发出的许可、署名或其他资产全部保留，不按文档扩展名删减。node_modules/dist/build/.hvigor/oh_modules/生成 rawfile 等从源枚举排除。

因此 root 更新最终根 README、交付文档、测试代码或报告不会影响应用输入匹配。package.json 和 lock 属依赖/构建配置，若再改 scripts 或依赖，完整配置证明会变化，应明确记录；不把这种变化伪称界面源未改。

source-manifest.json 记录 scope 和每个输入路径/字节/SHA；独立复核重新枚举同一明确集合，检查新增、缺失、修改及逐文件 SHA，而非只比较旧文件清单。包体另外核对所有 1,071 项 web 资产实际字节/SHA、原生编译和 app 身份。源码集合匹配与资源核对是两个独立证据。

build-lantern-ui-v11-beyeqowt 的 2026-10-13 09:03:26 UTC 独立 proof 按此规则重新枚举：1,228 项构建输入新增/缺失/修改均为空，1,071 项包体资源一致。root 后来继续修源，该 proof 只绑定历史时刻，下一次构建需再次明确冻结。该历史包随后在全新独立 QA 实例验证首次安装与启动，见 SIMULATOR_CLI_QA.md；未作为最终交互验收。

# 公开共学本地批次开发验证

2026-10-15 UTC；本文件记录开发验证，不是独立QA、真实认证或公共发布验收。

工作区`vocab-work/public-local-20261015/site`，分支`feat/public-local-20261015`，基线CT-r3 `30257b3a8acdf26258d4310a22ef480e8c9e4f6a`；本地0.3.6/20018。最终身份与制品哈希以外层`DELIVERY-PUBLIC-LOCAL-r3.json`为准。

## 实现范围

D01/D02访客本机试学和可跳过首配，空考期、口语暂不设置、建议分钟/听读目标、设备候选时区和UTC回退提示。旧配置通过保存来源保留，不根据是否做过题重置。只有theme创建的新服务器profile明确标theme-only，不把它当确认目标；原存储schema与scope未迁移。

D03按Study、词卡、计划/候选/训练、模考、录音、私人云题包分别呈现。remoteReadState区分本机可读与云端确认，第一次云读取失败不称账号无历史。D04页只列真实能力和迁移/退出/删除边界，无假成功。D05区分401、403、身份409、payload422、临时网络和音频读取；既有站点会话可显式同owner只读重核后续原队列。不能把它称手机号重新认证。

D06/D07来源索引含实际文件摘要，MIT不外推到依赖/资产，词典保留CC BY-SA，音轨/同人/图标权利待核；随包.txt说明可经原生text/plain打开。反馈只由用户主动打开，不附带私人记录。D08名称与CT草稿范围更清楚，备份格式/恢复算法不合并。

## 验证入口

- `node --test tests/*.test.cjs`：完整CJS行为、真实内存SQLite和受控异步/组件回归。
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`、内容校验、Web构建和MJS契约。
- `PUBLIC_LOCAL_MODE=web/native node tests/browser/public-local.cjs`：实际共享React、隔离浏览器记录，双主题×320/430px；17步/模式。不是ArkWeb或真实系统输入验收。
- `node tests/browser/continuous-training.cjs`：训练回归另列；不会改变原CT源码。
- `node scripts/check-public-distribution.mjs --target web`：当前应拒绝公共分发；退出1是预期权利门禁，不是本地构建失败。
- 外层SDK工具在ASCII临时staging构建unsigned包，源前后核对；不签名、不安装、不操作设备。

最终实际结果与日志路径在交付清单记录，不累加不同检查层次冒称全流程通过。

## 未完成与门槛

独立QA；真实ArkWeb/IME/Back/后台/冷启/麦克风；PWA离线冷启；真实收码、BFF/Cookie/令牌撤销/CSRF、地区网络、产品UID及新版持久scope、迁移写入/删除、全域服务端隔离和录音F01；全套依赖/主题/图标/合成声音公共权利及最终公共逐文件allowlist；真实公开部署。当前旧站仍私有，不能仅开首页或看见本机流程就报多用户完成。

回退保留所有本机/账号数据和备份；CT session v2仍要求兼容reader，不能用旧P2-r3直接读/导出。首配metadata来源和新theme-only元数据不得被猜测为用户事实。


## 最终开发结果（PUBLIC-LOCAL-r3）

最终身份`PUBLIC-LOCAL-20261015-r3-358f50f8fc76`，0.3.6/20018；1,374项运行输入SHA `358f50f8fc76fda9942e21a5af94e44d056508c70adbb9ca18d4a24c82ee2503`。703/703 CJS、34/34构建契约、tsc、68题/5类口语/22资源内容结构、Web构建与SDK26.0.0.105 unsigned HAP通过。Web及nativeMode浏览器各17/17，各20截图，错误0、源未变、自有服务已停；nativeMode不等于ArkWeb。根开发亲看320奶油首学及空洞账号页，最终语义布局保持。

记录：`reports/public-local-*-r3.log`与外层最终DELIVERY（含报告路径及SHA）。旧r1/r2试构建及前格式源码ZIP保留；r3仅收口仓库行尾、证据摘要和构建身份，无新增产品范围。

公共分发gate当前预期exit1/eligible=false：依赖通知、同人/图标/声音及最终逐文件allowlist未完成。不能将SDK或本地页面通过当公开发行许可。

2026-10-15 dot转来CT-r3原生主轨暂停后续播疑似回开头；QA仍复核，未判正式FAIL。只读定位Range与seek确认路径，不在本分支修训练/宿主。此候选继承该待验边界，不能获得组合发布放行。最终DELIVERY会把此依赖单列。

**救援reader/export工件尚未交付。** 兼容v1/v2且禁写是先前写出的回退条件，当前源码/Web/HAP是正常读写候选；旧P2-r3不能降级读取v2或混合备份。回滚就绪保持NOT_RUN，不将条件文字冒充救援包。

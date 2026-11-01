# 当前项目状态

2026-11-01：华为账号登录在独立分支 `feat/huawei-login-20261101` 完成本地接入，基线 `12f50171a79997029925a0743f29ace79995bd7d`。真实原生 Account Kit 校验随机 state，授权码只在原生与服务端流转；服务端交换并核对 Huawei token-info 的应用、用户类型、有效期和 OpenID，再签发原产品会话，客户端独立 v2 核对成功才进入学习。已登录用户须主动绑定，提交时事务重验原 owner/session，冲突不转移身份，原密码与旧响应保持兼容。SDK 授权使用独立时限，前后台等待不复活旧 owner；页面离开、超时与未知结果保持隔离。

新增固定 `/api/auth/providers`、`/api/auth/huawei/login`、`/api/auth/huawei/bind`；能力发现与旧 capabilities 分开，缺配置或无原生 SDK 时关闭入口。服务端仅引用 `LANTERN_HUAWEI_CLIENT_ID` 与 `LANTERN_HUAWEI_CLIENT_SECRET` 环境绑定，密钥不进入 App。主库追加 `0009_huawei_auth.sql`，独立 auth-only 库追加对应 `0002_huawei_auth.sql`；部署者须先备份现库、只执行新增迁移、替换运行服务实际加载的打包 Worker 并注入环境绑定，源码变更不会自动更新本机运行副本。

本地类型、159 项账号专项回归、17 项 CI 连接规则、auth-only 构建和真实 workerd/D1 受控出口 11 项通过；Shared 单次构建与实际 320/390/390 的 200% 字号三条件通过，API26 CompileArkTS 通过且无 HAP。普通 Web 入口关闭继承真实组件检查；浏览器 SDK/HTTP 为受控端口，未冒称真实 Huawei REST/SDK 授权。20068、运行服务、现库、证书与手机保持不变；真实华为授权、现用 profile 与新 Client ID 的运行兼容及无 VPN 网络仍待集成者验证，不记正式发布或 GitHub CI 通过。

2026-10-31：词卡整改在独立分支feat/vocab-card-correction-20261031完成，来自6798ccf，已纳入f437e85测试only后继。新词采用项目固定打散策略（非词频/难度断言），复习规则与已开始队列不变；已保存“认识”的当前/上一词可改为忘记，原事实保留、SRS按原复习时间修正且不多计学习；上一词仅回看不退持久游标。词卡rating spinner移除，保存锁/失败重试保留。类型、改判13项、相关回归、UI25项、词库/API21项及实际Shared核心6项通过；原测试夹具失败保留。未改账号/原生/版本或触设备/签装/部署，合入20065和最终包验证由集成者完成。新备份含更正时为v2，新客户端读v1；旧客户端/旧API不支持新更正类型，不能声称双向旧版兼容。

2026-10-31：普通练习跨任务续练已完成开发交件，基线bb1571b12c9bb40f589fd2de849d8052dd0961ef；实际构建产品源c2fc9bf2423b3632e61bc4e1c7df548c4bc78c6d，分支feat/practice-task-resume-20261031。领域130项、返回及相邻UI45项、实际Shared/Web各19项、SSR1项、类型和两端构建通过。原QA§16与设计独立复核待执行；无HAP/手机/签装/推送/部署。精确交件和原始失败统一见项目组internal-beta-20261028/UI-IMPLEMENTATION.md本轮段落及practice-task-resume-20261031/candidate.json；旧runtime buildId不冒称本轮指纹。

2026-10-30（Asia/Shanghai）：本地测试候选版本元数据更新为 **0.4.6 / 20062**，分支 `feat/beta-version-20062-20261030`，精确父提交 `f2024affe3935968a3f6cf0d7e812366d978278d`。仅同步 AppScope、三个 package、两个 lock 根节点及当前 release/runtime 版本；依赖、业务、UI、ETS 和内容与 f202 相同，继承其限定本地功能 QA（项目组 `speaking-noise-20261028/PERFORMANCE-BASELINE.md` 第464行），此次只做版本一致性与差异断言。`public/build-identity.json` 的 buildId、sourceInputsSha256、inputCount 保留旧20061指纹，不代表本候选新冻结身份；现有 Shared 仍为 f202 原制品。未构建20062二进制，未签装、推送或发布；整体性能、真实设备、录音音质与认证部署仍开放。

以下为2026-10-24历史交付记录，不代表本候选发布状态。

更新：2026-10-24；发布方式见 [分级验证与发布](RELEASE_POLICY.md)。

| 项目 | 当前事实 |
| --- | --- |
| 产品版本 | 0.4.5 / 20059 |
| GitHub 源码 | a4b78796456094ae840770b48c5a9bd5554d7306，[PR54](https://github.com/godnight/lantern-toeic/pull/54)，未合并、未打 tag |
| 网页 | 已部署，[原站点](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)，访问权限保持 |
| App | 原证书签名；手机已原位升级至 20059 并启动，无卸载或清空数据 |
| 本次改动 | 今日安排两卡的操作行、字号适配和点击/焦点反馈 |
| 定向验证 | 源码、实际 UI 与续滚点击通过；正式构建、签名、包核对通过 |
| 整套 CI | [Core](https://github.com/godnight/lantern-toeic/actions/runs/40094443610)失败（Web 主题刷新等待 networkidle 超时）；测试改为等待 DOM 和现有界面就绪信号后，本地定向 Web 主题 57/57 通过，历史 run 不改记成功；[Harmony](https://github.com/godnight/lantern-toeic/actions/runs/40094443556)已通过。以对应 run 终态为准 |
| 当前工程工作 | 分级 CI、简化签包入口和单一交接；不改变已发布产品 |

## 已知问题与范围

口语录音偶发杂音仍未解决，按用户要求暂停定位。真实短信供应商未启用。当前通过结论不代表逐条真实学习数据、全部生产账号流程或所有音频人听已验。

旧版、失败日志和验收证据保留；未变部分可继承既有结果。新问题仅按影响范围补查，不因一个页面的小修改重启全部历史待办。

[此前状态历史](https://github.com/godnight/lantern-toeic/blob/a4b78796456094ae840770b48c5a9bd5554d7306/docs/PROJECT_STATUS.md)只在排障或追溯时读取。当前状态保持简短，不继续向本文件堆叠历史快照。

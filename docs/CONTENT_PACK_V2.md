# LANTERN 原创题库补充包 v0.2.0

本包含 40 道新增原创练习，沿用 `Question` 结构；每题另附 `contentVersion` 和 `provenance` 元数据。练习主题覆盖办公协作、培训、公共交通、图书馆、文化展览和印刷服务，适合青少年学习者。题目、英文材料、中文解析、译文与词汇例句均为本次创作。

## 内容构成

| Part | 新增题数 | 组织方式 |
| --- | ---: | --- |
| Part 2 | 8 | 独立应答题，每题三个选项 |
| Part 3 | 6 | 两段完整双人对话，每段三题 |
| Part 4 | 6 | 两段完整独白，每段三题 |
| Part 5 | 8 | 短句填空，每题四个选项 |
| Part 6 | 8 | 两篇完整四空文本，每篇含一道整句补入题 |
| Part 7 | 4 | 一篇单篇阅读两题；一组双文档阅读两题 |
| 合计 | 40 | 未新增 Part 1 图片题 |

Part 7 是精简的教学练习组；整个内容包不是完整模拟试卷。

## 官方格式核对

核对日期：2026-09-07。IIBC 官方格式页说明，Part 3 共 39 题、每段对话配三题；Part 4 共 30 题、每段独白配三题；Part 6 共 16 题、每篇配四题。本包沿用这些成组结构。来源：[IIBC — Test Format and Content](https://www.iibc-global.org/english/toeic/test/lr/about/format.html)。

该来源仅用于核对格式事实。本包没有复用官方样题、原文、音频或逐字考试说明，也不是 ETS 或 IIBC 的官方内容。

## 接入说明

- 将 `questions-added.json` 数组追加到题库；本包 ID 使用 `p2-v2-01` 至各 Part 的对应末尾编号，与核对时的 28 道旧题无冲突。
- 同组 `passage` 或 `transcript`、`audioText`、`translation` 已逐字一致；请保留 `groupId` 以便整组练习。
- 所有听力题都提供 `transcript` 与 `audioText`。Part 2 两字段包括问题及三个应答；Part 3/4 两字段提供完整共同材料，题干和选项保留在各题字段中。
- Part 3 使用清晰的 `Nora:` / `Evan:`、`Lena:` / `Sam:` 说话人标签。若语音引擎需要不同声线，可根据这些标签分配；本包不附录音文件。
- Part 6 两篇各有 `[1]` 至 `[4]` 四个空位；`p6-v2-03` 和 `p6-v2-07` 是整句补入题。中文译文是按正确答案补全后的全文，适合答后显示。
- `difficulty` 仅为教学标签：基础 26 题、进阶 14 题；不是经统计标定的难度，也不能直接转换为 TOEIC 预测分数。
- 每题 `provenance` 为 `{author: 'LANTERN 原创内容组', method: 'ai-assisted-original', license: 'CC-BY-4.0', reviewStatus: 'automated-reviewed', humanReviewed: false}`。自动复核状态不表示通过真人教师审校。

## 复核结果

结构校验通过：40 个新 ID 唯一；题数分布符合要求；选项数量、选项唯一性、答案索引范围、必填字段、听力字段和组内全文一致性均通过。Part 5 正确答案可逐字还原 `evidence`；Part 6 每组均有四个不同空位和一道整句补入题；Part 7 单篇及双文档各一组。

答案位置分布：Part 2 为 A=3、B=3、C=2；其余 32 道四选一题为 A=8、B=8、C=8、D=8。

完成第二遍模型语义自查：重新核对 40 道题的题意、正确选项、证据、干扰项和中文译文。每道解析均给出选择依据及干扰项排除理由。时间题分别核对了 16:10 加 5 分钟为 16:15、09:30 提前 15 分钟为 09:15，以及同日 09:00 距 12:00 截止尚有三小时。双文档题只判断邮件发出时间与请求内容，没有将未确认的修改写成已被商家批准。

复核中为酒店接驳车对话补明“今天下午”，使 P.M. 选项有明确依据；将 Nora 的行动证据扩为完整原句；删除译文里原文未明确写出的“每天”。所有题目随后重新生成并通过结构校验。

本轮没有真人教师评审、学习者试测或题目统计校准。

## 答案与审查索引

以下均已对照完整材料复核；详细中文论证与干扰项说明见各题 `explanation`。

| ID | 题目 | 答案 | 正确选项 |
| --- | --- | :---: | --- |
| p2-v2-01 | 找到站内服务点 | A | At the machine beside the ticket office. |
| p2-v2-02 | 安排发送会议纪要 | B | Certainly. I'll email them in ten minutes. |
| p2-v2-03 | 理解打印机旁的提示 | C | There's an unopened pack in the cabinet. |
| p2-v2-04 | 选择寄送方式 | A | Use a courier; the client needs them tomorrow. |
| p2-v2-05 | 确认材料数量 | B | Twenty, including two for the reception desk. |
| p2-v2-06 | 为何调整日程 | C | The team leader is traveling on Wednesday. |
| p2-v2-07 | 回应否定疑问句 | A | Yes, for six people at twelve thirty. |
| p2-v2-08 | 询问工作负责人 | B | I'm not sure; ask the information desk. |
| p3-v2-01 | 培训讲义 · 遇到的问题 | A | Printed materials will arrive after the workshop begins. |
| p3-v2-02 | 培训讲义 · 推断实际意图 | B | The workshop should begin at its scheduled time. |
| p3-v2-03 | 培训讲义 · 下一步行动 | C | Ask reception to deliver some tablets. |
| p3-v2-04 | 接驳车 · 行程变更原因 | D | Construction is taking place. |
| p3-v2-05 | 接驳车 · 时间计算 | A | 4:15 P.M. |
| p3-v2-06 | 接驳车 · 定位设施 | B | Beside the information desk. |
| p4-v2-01 | 培训留言 · 通知目的 | C | To announce a change of training room. |
| p4-v2-02 | 培训留言 · 到达时间 | D | 9:15 A.M. |
| p4-v2-03 | 培训留言 · 自带物品 | A | A pen. |
| p4-v2-04 | 历史中心 · 展品来源 | B | Local residents. |
| p4-v2-05 | 历史中心 · 预约截止时间 | C | Before noon on Saturday. |
| p4-v2-06 | 历史中心 · 导览之后 | D | Try a digital map table in the east gallery. |
| p5-v2-01 | 词性 · 可供使用的设备 | A | available |
| p5-v2-02 | 介词 · 提交截止时间 | B | by |
| p5-v2-03 | 被动语态 · 检查设备 | C | inspected |
| p5-v2-04 | 连词 · 让步关系 | D | Although |
| p5-v2-05 | 主谓一致 · 每位成员 | A | receives |
| p5-v2-06 | 代词 · 名词前的所属关系 | B | your |
| p5-v2-07 | 比较级 · 两个版本的效率 | C | more efficient |
| p5-v2-08 | 动词搭配 · 核对确认邮件 | D | check |
| p6-v2-01 | 访客登记 · 第1空 | A | registered |
| p6-v2-02 | 访客登记 · 第2空 | B | before |
| p6-v2-03 | 访客登记 · 第3空整句补入 | C | They should show this code to the receptionist when they arrive. |
| p6-v2-04 | 访客登记 · 第4空 | D | issue |
| p6-v2-05 | 接驳车试运行 · 第1空 | B | depart |
| p6-v2-06 | 接驳车试运行 · 第2空 | A | their |
| p6-v2-07 | 接驳车试运行 · 第3空整句补入 | D | Return shuttles will run from the park to the station from five to seven in the evening. |
| p6-v2-08 | 接驳车试运行 · 第4空 | C | until |
| p7-v2-01 | 电子阅读器借用 · 借期 | A | Fourteen days. |
| p7-v2-02 | 电子阅读器借用 · 领取要求 | B | A library card. |
| p7-v2-03 | 地图印刷订单 · 跨文档时间判断 | C | It was sent three hours before the stated deadline. |
| p7-v2-04 | 地图印刷订单 · 没有变化的安排 | D | The branch where the maps will be collected. |

## 文件

- `questions-added.json`：供题库接入的 40 题 JSON 数组。
- `validation-report.json`：本轮机器结构校验结果。
- `validate_pack.py`：可重复运行的结构校验；校验旧题冲突时读取现有题库，不修改它。
- `build_pack.py`：生成该补充包的作者脚本；输出位置为本工作目录。

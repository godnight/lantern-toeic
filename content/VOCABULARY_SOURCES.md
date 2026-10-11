# 托业场景词库与英汉查词来源

2026-10-11，v0.3.2 在原有 240 个场景词上增加 567 个，共 807 个；仍分办公、人事、会议、财务、销售、物流、出差、酒店餐饮、技术、设施维护、健康福利、社区服务 12 类。加上 55 个额外题内表达，共 862 个学习条目。原词条 ID、生词及复习记录保留，不因扩词或查词数据更新重置。

## 选词依据

参照 ETS 对 TOEIC Listening & Reading 日常与职场语境的公开介绍确定范围；并非复制其试题、教材、词表或例句。官方没有为本项目背书。本库不声称完整覆盖、词频排名或分数保证。

- [ETS：Listening & Reading test](https://www.ets.org/content/ets-org/language-master/in/home/toeic/test-takers/about/listening-reading.html)
- [ETS：Listening & Reading test guide](https://www.eu.ets.org/content/dam/ets-org/eu/pdfs/toeic/toeic-listening-reading-test.pdf)，主题介绍页（文档页码 4）。
- 核查日期：2026-09-19。

`vocabulary.json` 的释义、双语例句、搭配由项目原创编写，沿用 [LICENSE-CONTENT.md](../LICENSE-CONTENT.md) 的 CC BY 4.0。署名“LANTERN 微光托业场景词库 v1”，转载改动请标注。已检查数量、重复、字段、词性与例句匹配；未声称外部教师审校或考试统计标定。

`vocabulary-expansion.json` 的 567 条由项目独立选择并原创编写简短中文场景义（AI 辅助），同样按 CC BY 4.0，来源记录见 `vocabulary-expansion-sources.json`。新增词与原词库和题内表达的规范化精确重叠为 0；已复核拼写、词性、场景和短释，不是独立教师审校。新增词的例句及助记尚未补齐，不将通用词典的词源字段称作已完成的词根词缀联想课程。

## 题内词汇

`questions.json` 原有 60 个不同词形/表达（82 处引用，62 组释义/例句）继续使用，未改写源题。与原场景词重叠的 5 个合并入口，其余 55 个作为题内表达，与 807 场景词合计 862 个学习条目。`reserve` 与 `replacement` 的多组释义、例句均在相关题目区域保留，并可回到完整题组练习。

## 通用英汉查词

另接入 84,979 条中文维基词典英语词条，来自 [Kaikki / Wiktextract](https://kaikki.org/zhwiktionary/) 的结构化提取，源快照日期为 2026-10-01、提取日期为 2026-10-02。数据在进入查词时按需加载，收藏后可加入词卡复习；收藏和复习记录纳入词库记录备份。备份保存学习记录，不复制整部词典。通用查词范围含专业义、旧义和词形，不应把 84,979 条全部宣传为托业词汇，也不承诺完整覆盖常用商务词。

原始内容署名“中文维基词典贡献者”；结构化提取署名“Tatu Ylönen、Wiktextract / Kaikki.org”；筛选、繁简转换和格式整理署名“微光托业”。本衍生数据使用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，保留逐词来源、编辑历史和许可入口；不得改标为项目原创 CC BY 4.0。来源 URL、输入及成品 SHA-256、大小写归并、义项筛选、OpenCC 转换和上游限制均记录在 `dictionary-metadata.json`。

没有从该数据复制音频、例句或引文；词形不等于词根词缀，词源仅展示上游已有内容。全库未经逐词人工校审，项目场景短释优先保留；通用词典释义作为独立的参考资料。

## 语音

网页版使用设备系统朗读。鸿蒙内置本机 Microsoft Zira Desktop 合成音频，场景词、题内表达及旧练习精确文本去重后共 1,015 段；不覆盖整个通用词典。来源、工具、文本与文件哈希见 [mobile/offline-audio](../mobile/offline-audio/README.md)。合成语音不等于真人或官方发音，生成和解码验证不代表逐词人耳审校；音频供应商权利与文本许可分别标注。词库例句跟读仍为后续功能。

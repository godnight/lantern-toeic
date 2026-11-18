# 场景词与通用查词

2026-10-11，v0.3.2。入口为训练之境或学习书库的托业场景词库，切换“托业场景词 / 英汉查词”。

场景词有 807 条（原240 + 新567），另保留55条题内表达；`content/vocabulary-expansion.json` 是项目独立选择和撰写的简明场景义，含AI辅助，未经真人教师审校，不是ETS官方词表或词频排名。新增词没有虚构例句或词根，来源见 `content/vocabulary-expansion-sources.json`。

通用数据来自中文维基词典，经 Kaikki / Wiktextract 提取，dump 2026-10-01、提取2026-10-02。归并后的84,979个词形与短语是查词资料，包含专业词、词形和旧义；现有240场景词仅91个出现在上游提取结果中。因此现有场景义始终优先，通用库不能替代托业学习库，也不保证全部常用词可查。

本项目合并“英語”“英语”两份 `lang_code=en` 导出，规范化词头和大小写，中文经OpenCC转简体，保留每词最多8义、4音标、12词形和1500字符词源节选。普通小写义项优先于同形专名。词形不等于词根；词源参考不等于项目编写的记忆联想。没有导入第三方音频、例句或引文。

文本及衍生文件采用 **CC BY-SA 4.0**；作者是中文维基词典贡献者，结构提取为Tatu Ylönen / Kaikki / Wiktextract，项目进行了上述加工。原词条和其编辑历史通过详情页的来源链接可达。完整元数据、原文件SHA256和派生文件校验值在 `content/dictionary-metadata.json`，分发说明在 `public/dictionaries/NOTICE.txt`；这些许可与软件MIT、原创场景义CC BY4.0分别适用。

## 数据与复习

词典按需读取独立的哈希文件，并验证SHA256、版本、数量和字段。首次下载失败或损坏可重试，场景词仍可使用。查词与生词本/到期筛选均搜索全部保留的义项和词形。记录以稳定词条ID保存，继续使用原v1事件与备份格式；旧295词的ID和主要字段未改变。词典条目并不自动变成学习计划，需本人收藏或开始自测。尚未载入的词条保留历史计数并明确提示。

鸿蒙把词典和1,015段精确文本匹配的合成音频随包安装；807场景词和55题内表达都能使用已有播放链路，通用查词结果只有已打包的匹配词能离线发音。Web使用设备系统朗读；词典缓存用于重复访问，但Web离线整页冷启仍是原有离线提示页，不能宣称完整PWA离线应用。

## 重建与核验

官方上游地址、日期及SHA256见元数据。原始输入下载到独立工作目录，不把原始大文件或个人记录放入仓库。使用Python和 `opencc-python-reimplemented==0.1.7`：

```sh
python scripts/build-wiktionary-dictionary.py --input-dir /path/to/inputs --output-dir /path/to/output --opencc-deps /path/to/deps --core-vocabulary content/vocabulary.json
```

人工检查输出及常见词义项顺序，将结果按SHA256前12位命名为 `public/dictionaries/zh-en-<hash>.json`，同步元数据的file、sha256与count。不让输入文件覆盖现有学习记录。`npm run test:dictionary` 与 `npm run test:dictionary:browser` 验证模型、真实组件和实际浏览器链路；旧词事件、学习进度、模考和录音数据均使用原存储。

资料核查时放弃直接采用FreeDict英汉结果，因为多处常见商务词翻译错配；ECDICT未确认混合内容的完整授权链。未将这两个候选库的数据加入产品。

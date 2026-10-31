# 单词卡音标与词源参考

核查日期：2026-10-24。`content/word-card-reference.json` 是单词卡的展示补充，不改变教学词条、学习快照、评分、入库资格或音频绑定。前后两种卡片状态可以共用音标；词源只在揭示释义后显示。

2026-10-26 界面调整：按用户要求移除词卡内“参考来源”入口，音标与词源正文继续显示。来源、固定词条链接、作者及许可仍保存在本说明和参考数据中，不改变或删除底层归属信息。

## 范围与实际覆盖

| 范围 | 词头 | 有音标 | 有词源 |
| --- | ---: | ---: | ---: |
| 当前教学词 | 4040 | 4034 | 508 |
| 既有核心/扩展场景词 | 807 | 769 | 89 |
| 两者去重 | 4222 | 4178 | 529 |

当前教学词仍有 6 个缺音标：additionally、environmentally、professionally、takeover、urgently、webpage。已核查其英文维基词典固定版本，但 English Pronunciation 未提供 IPA；保持缺失，不用拼写或词缀规则生成。旧场景词另有部分短语/词形缺失，完整清单在 JSON 的 `coverage` 中。

没有结构化词根词缀表。`etymology` 保留现有词典的词源/构词原文，不能把词形变化 `forms` 或 `exchange` 当作词根。资料未经逐词人工语言学审校，不宣称每个词都具有英美两套音标，也不宣称音标与本应用音频的口音已逐词匹配。

## 来源与许可

1. **中文维基词典 / Kaikki**：优先复用既有 `public/dictionaries/zh-en-63cf606ec4d0.json` 中精确词头的音标和词源。版本、原始提取和摘要在 `content/dictionary-metadata.json`；署名沿用中文维基词典贡献者、Tatu Ylönen / Wiktextract / Kaikki.org，以及微光托业的筛选整理。该部分及其衍生内容采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。原词条与编辑历史可从 `https://zh.wiktionary.org/wiki/{词头}` 进入。本次仅裁取已有资料，不重新翻译或生成词源。
2. **ECDICT**：仅补既有音标缺失的精确词头。固定提交 [ab22ad36302cafc6349a050e2b60894855208055](https://github.com/skywind3000/ECDICT/tree/ab22ad36302cafc6349a050e2b60894855208055)，使用 `ecdict.csv` 的 `phonetic` 字段；CSV SHA-256 为 `d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`。上游说明音标以英音为主，保留原有符号，不按词尾推导、不去重音、不替换成其他词的读音。[原许可证](https://github.com/skywind3000/ECDICT/blob/ab22ad36302cafc6349a050e2b60894855208055/LICENSE)为 MIT，版权及完整许可文本保存在生成 JSON 的 `sources.ecdict.licenseText` 和本页下方。
3. **英文维基词典**：只对本次缺失的 27 个教学词进行有界查阅，补到 21 个，另核对 `resume` 的已知名词/动词歧义。仅取 English Pronunciation 下完整的 IPA，不取法语等其他语言。每词固定 `oldid`、来源 URL 和取回内容摘要记录在 `content/word-card-phonetic-supplement.json`；作者为 English Wiktionary contributors，采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。来源数据中的词条链接指向对应固定版本。

`resume` 是明确的特例：当前 `v-resume` 教学卡指“简历”。既有通用词典只提供动词 IPA，词源又合并名词和动词。本表改取 [resume，revision 93719176，Etymology 2](https://en.wiktionary.org/w/index.php?title=resume&oldid=93719176#Etymology_2) 的名词音标，并只保留既有中文词源中对应名词的那一段。`partOfSpeech: "noun"` 与 `overrideWordIds: ["v-resume"]` 要求展示层核对词性及简历语义；动词或混合词性不能应用这个参考，也不修改任何已存快照。`résumé` 仍按独立精确词头查询其 English 读法，不从 `resume` 自动去重音匹配。

本表中的维基词典部分、ECDICT 部分及软件代码的许可分别适用。每条引用通过来源键保留作者、来源与许可；不得移除这些归属信息。

## 可复现生成

原始 66 MB CSV、下载的许可证及词条 HTML/JSON 放在仓库外，不随产品提交。生成器只读取输入，不联网、不扫描音频、不改学习数据。

```powershell
python -B scripts/build-word-card-reference.py --ecdict-csv '<固定提交的ecdict.csv>' --ecdict-license '<同一提交的LICENSE>'
```

加 `--check` 只比对生成结果与已有 JSON，不改文件。脚本核对固定 CSV 摘要和既有词典摘要，按当前声明教学词与核心/扩展场景词裁取，词头规范化与 `searchText` 一致（NFKC、小写、折叠空白，保留重音）。未新增词头近似匹配、词干推断或多音字算法。

## ECDICT MIT notice

MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

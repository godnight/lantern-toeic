# IV05 交卷反馈独立回归

2026-10-13 08:48 UTC。实际 `QuestionBody`、`ExamPaper` 通过TypeScript transpile和React `renderToStaticMarkup`执行；其余已有repository/Hook/rAF回归继续保留。只用synthetic题包与内存，不读写真实学习数据。

完整 `ui-redesign-exam.test.cjs` **22/22通过**，其中原18项保留、新4项覆盖：

- 保存错选A：A为answer-wrong且checked、文字“你的答案 · 回答错误”；正确B为answer-correct但不checked，反馈错误并展示原解析，不能沿用selected。
- 保存正确B：B同时有“正确答案 · 你的答案”且唯一checked，反馈correct，无wrong/unanswered。
- 已交卷漏答：没有checked/“你的答案”，正确B单独标明，反馈unanswered，不能假称错误或答对。
- 未交卷：即便传入含answer/私密explanation的完整题，错选A/正确B/未选均只能普通selected和清除按钮；不显示任何correct/wrong/反馈/答案/解析。

原ExamPaper测试仍传入保存A、暂选B，并断言交卷后锁定A。新测试同时断言渲染不修改题对象、提交fieldset disabled。

运行：`LANTERN_SITE_ROOT=<site绝对目录> node --test ui-redesign-exam.test.cjs`。Root集成到site/tests后无需环境变量。

可集成文件SHA256：`701D83BE72D604A8E097A09BA5FB955A4307524FFD352D1C25076830F791DAD1`。Mock源SHA `6D936837D7EC09275AEF4433610BAE5EDB2712A65C0259F6F36B69AB3F3270D7`。

样式只读确认最终wrong使用danger-soft、correct使用已定义ui-surface-muted回退mock-surface、unanswered使用warning-soft，border与图标文字语义独立；CSS SHA `5F20D9F86A99BAFCADB724B1B69C727865FFBC940FECEC7F295F8C3065D7FA71`。这些渲染断言不能替代四主题/320px真实像素对比。

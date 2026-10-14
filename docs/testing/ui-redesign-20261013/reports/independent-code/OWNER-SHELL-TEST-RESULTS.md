# C09 账号壳投影独立回归

2026-10-13 08:50 UTC。`ui-redesign-owner-shell.test.cjs` **2/2通过**；为可单独集成的Node suite，实际useStudy、study-model、StudyApp、WorkspaceShell执行，存储/React hooks/DOM/history为内存适配器。没有浏览器、服务器、云端API或真实用户记录动作。

1. Alice真实hook读取有效snapshot（独特昵称、silk、一个旧wrong attempt）后改owner为Bob。Bob future-schema夹具使新owner不能读取。首个Bob返回**ready=true、recordsReadable=false、data仍Alice**：修复前Root壳可见Alice昵称/复习徽标1/silk；effect后失败态是EMPTY/blocked，未观察到持久旧昵称。修复后正常Alice信息保留；首切和失败壳中性“记录暂不可读”，无旧徽标，主题effect为paper；原Alice存储字节不变，零write。
2. 显式ready=false且携带旧昵称/hollow/wrong attempt的loading投影：真实Root壳显示“正在读取记录”、无复习徽标，主题effect为paper；输入data未被清空。这是独立投影边界，不声称实际hook自然生成了该loading组合。

Root仅使用 `data=ready&&recordsReadable!==false?storedData:EMPTY_DATA` 作展示，profile/due/theme和main依此派生；没有修改hook/storage/API，也不会写回EMPTY_DATA。badge prop的0意为隐藏，不能当成真实存储为零。

运行：`LANTERN_REVIEW_ROOT=<site绝对目录> node --test ui-redesign-owner-shell.test.cjs`。Root集成到site/tests后无需环境变量。

可集成文件SHA256：`451AA06F365F31968717CF97B190352467B4351C91902A18B5DC32F8B61A894B`；Root SHA `60257409A413BB46DF38B14A814224360C81B2C299BAAE5DFCFA2351BB7190AC`。

另有 `probe-owner-shell.cjs` 及 `probe-owner-shell-result.json`（08:48:17）保存四阶段投影；实际像素/路由owner更新的ReactDOM调度仍由Root的Chrome证据补充。未发现剩余C09代码阻塞。

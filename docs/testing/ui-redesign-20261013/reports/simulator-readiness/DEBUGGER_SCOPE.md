# ArkWeb 调试与本轮受支持浏览器接口

2026-10-13，只读判断；没有启用调试、开端口、转发 HDC、点击原生 UI 或安装应用。

本机官方 SDK 26 的 ets/api/@ohos.web.webview.d.ts 提供 WebviewController.setWebDebuggingAccess(boolean)，API 文档明确默认 false。API 20 另提供 boolean + port 重载。生产 Index.ets 不含该调用，因此普通 debug HAP 并不能当作已经暴露了 ArkWeb DevTools。

官方 API 指向 “Debugging Frontend Pages by Using DevTools”。这说明单独的开发调试配置可让 DevTools 检查前端；不等于当前 Codex browser provider 自动具备附加到任意 ArkWeb 调试目标的能力。

本轮 cua_repl 暴露的浏览器入口为 getBrowser/getTab/createBrowserTab/listBrowsers/listTabs；接受现有 provider ID、URL、tab ID 或 mention。文档没有任意 CDP 地址的 attach/connect 接口。只读 getState 返回登记的 Chrome extension、Codex IAB 和 MCP Apps，没有登记的 ArkWeb provider；Chrome 请求头策略读取失败，所以该次空 tabs 不能证明用户实际没有打开浏览器标签。

本轮结论：不能通过当前受支持接口宣称 ArkWeb 实际 UI 验收已完成。也不应将 Chrome 的 nativeMode 渲染等同原生 ArkWeb。若之后获得已支持的 ArkWeb/CDP provider 或启用原生 CUA，再按独占模拟器、真实布局/截图及数据保护流程验证。当前不以 shell Playwright/CDP、HDC uitest 点击或自建 UI bridge 绕过限制。

以上限制不会阻止在隔离目录构建和验证未签名 HAP。麦克风/扬声器信号、系统选择器、原生 Back、前后台与 Pura X Max 内外屏仍须保留为独立设备验收项。

# v0.2.3 美术改版测试执行补充

日期2026-09-08；范围为本次美术提交。总测试设计见[39个场景](TEST_DESIGN.md)，v0.2.2学习/同步测试是历史基线，不冒充本次鸿蒙设备结果。

## 实际执行与证据

| 检查 | 结果与边界 | 证据 |
|---|---|---|
| 桌面首页 | 新场景边框、两种学习入口、当前世界按钮可见；点击当前世界打开主题选择，切绯红成功。 | [桌面截图](evidence/v0.2.3/lantern-v023-desktop.jpg) |
| 手机宽度390 | 共享页面使用新蓝色竖图；正文、按钮可读；content宽375/scroll宽375。 | [390截图](evidence/v0.2.3/lantern-v023-mobile-blue.jpg) |
| 手机宽度320 | 初测content305/scroll349，目标卡导致溢出。改为单列目标区并缩紧任务标签后305/305；新红竖图可见。 | [修复后320截图](evidence/v0.2.3/lantern-v023-mobile-red-320.jpg) |
| 主题文件 | 3主题、8原创图、19参考入口与2个ZIP哈希通过；图片实际940×1672/941×1672。 | [art.log](evidence/v0.2.3/art.log)、art/themes.json |
| ZIP包体 | 2包均可打开，CRC、图片SHA-256、内容与应用文件逐字节一致；每包当前横/竖图+manifest+README。 | [archive-verification.json](evidence/v0.2.3/archive-verification.json) |
| 页面点击下载 | **未完成**。测试进入主题流程后浏览器控制连接Transport closed，未取得浏览器下载事件；不把ZIP本地验证算下载E2E通过。 | 没有下载E2E通过声明；须后续补U04/下载子场景 |
| 类型/Web/mobile/Harmony共享资源 | 通过，命令与退出码见日志；Harmony 23个共享文件匹配。 | [commands.json](evidence/v0.2.3/commands.json)及同目录日志 |
| GitHub平台编译 | 查看本版PR的Core/Android/iOS/Harmony终态；构建通过不代表系统安装录音通过。 | [Actions](https://github.com/godnight/lantern-toeic/actions) |

环境为云端Chrome151、HTTP预览、owner=null。手机检查使用固定iframe宽度，内容宽因滚动条比设置值小15px。未模拟系统、DPR、触摸、安全区、键盘或ArkWeb。截图里的1分钟为隔离QA记录。

浏览器完成截图后，一次额外点击因已打开弹框无匹配而超时，随后传输关闭；没有使用其他浏览器方式绕过。所有临时测试HTML均已从public删除，保留tests/browser夹具。

## 交付限制

官方Press Kit只保存来源页与目录元数据，实际官方图片复制数0；本版下载包均为原创AI素材。完整生成prompt见art/portrait-generation-2026-09-08.json，使用内置图像生成，不使用官方角色原图作编辑输入。

网页未重新部署；鸿蒙HAP没有完整SDK编译、签名和真机验收。下一次先补下载点击、真实设备布局/权限、安装升级，不能据此次共享构建宣称鸿蒙APP验收完成。

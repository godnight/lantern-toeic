# 同一自有 QA 的最小人工检查

本说明仅提供手工步骤，没有执行设备操作。当前实例 LanternUIQA4d5098e7 使用 -noWindow；官方帮助没有把运行中的 headless 窗口动态显示的命令。先与协调者确认取证结束、没有未保存内容，仅针对本实例停止后再以保留数据的方式显示窗口。

~~~powershell
& 'D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\emulator\Emulator.exe' -stop 'LanternUIQA4d5098e7'
~~~

只有停止成功才继续。官方 stop 帮助只列名称；若找不到实例或失败，保留输出给协调者，不修改默认配置或强杀进程。

~~~powershell
& 'D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\emulator\Emulator.exe' -start 'LanternUIQA4d5098e7' -instancePath 'C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-native-qa-jbv3rhze\instances' -imageRoot 'C:\Users\Administrator\AppData\Local\Huawei\Sdk' -bootMode coldboot -hdcPort 15551
~~~

coldboot 的官方含义是 boot with data；reset 会重置数据。沿用原 C imageRoot 路径字符串，省略 -noWindow。没有删除、重新创建、安装、配置或操作旧实例的步骤。官方语法依据见 [帮助摘录](official-emulator-help-excerpt.txt)，来自已归档官方 help 的前 56 行。

系统启动后手工打开微光托业，只在这个自建 QA 中检查：

1. 首页、四主题、导航和一条带图内置练习，观察图片/图形/字体是否完整。
2. 查一个普通单词，观察详情能否加载；播放一段内置音频，观察是否正常或出现资源提示。
3. 保存观察到的界面、提示文字和时间给协调者；无需导入真实记录、提交练习或录音。

人工观察可补充可见影响，不能得到被掩码请求的 URL，也不能自动判定两条 404 无害。完整验收范围仍以父任务报告为准。

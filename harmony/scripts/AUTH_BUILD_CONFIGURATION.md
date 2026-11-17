# 鸿蒙账号构建配置

源码保留当前的默认账号服务地址和 Asset 别名，日常从仓库构建时行为不变。需要为已授权的正式设备复现指定账号服务和已安装 App 的会话命名空间时，在**仓库外的独立构建源码副本**中配置；不要直接修改工作区或把本地配置提交到 Git。

在受保护的仓库外目录准备 JSON 文件，字段仅限 `schemaVersion`、`apiOrigin` 和 `sessionAlias`。以下值是示例，实际值从已有受保护的构建配置获取，不能填写 token、密码或私钥：

```json
{"schemaVersion":1,"apiOrigin":"https://auth.example.test","sessionAlias":"synthetic-asset-v1"}
```

独立源码副本需保留仓库中的原始 `AuthConfiguration.ets`，然后运行：

```powershell
node harmony/scripts/prepare-auth-configuration.mjs --config "$accountBuildConfig" --staging-root "$isolatedSourceRoot"
```

工具只接受仓库外的配置文件与独立源码副本，校验 HTTPS origin、ASCII alias 和输入字段，并只覆盖与当前源码完全一致的配置文件；默认不运行。输出不打印参数值。重复执行或目标文件已被修改时会拒绝，需重新准备源码副本。工具不检查 Windows ACL，需由构建者保护配置文件及源码副本的访问权限；服务地址与 alias 会进入 App，不能当作秘密。脚本不签名、不安装、不启用账号服务，生成配置不代表服务或设备验收通过。

调用项目已有的 Shared、鸿蒙构建与签名工具时，使用该独立源码副本作为构建输入；生成配置须与目标 App 的账号服务及现有 Asset alias 一致，避免覆盖升级后丢失会话。版本身份及构建回执依旧按现有流程核验。

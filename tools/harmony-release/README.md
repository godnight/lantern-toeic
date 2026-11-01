# HarmonyOS 最终 HAP 签名

一个可复用源码入口：正式请求指定版本，工具完成一次内部预检、一次最终 HAP 签名、一次官方验签和签后载荷核对。普通版本递增不复制工具。它不构建、不安装、不推送产品，也不给 SDK 或辅助工具签名。

## 本机设置（首次或签名环境变化时）

实际签名在已有 HarmonyOS 工具链的 Windows 机器运行。将 `ENVIRONMENT.template.json` 复制到仓库外的本机目录，填写：

- 官方工具链根目录、既有加密 `build-profile.json5`、已有受保护私有输出目录的绝对路径。
- 已知成功的本地签名/设备匹配回执路径和其 SHA-256；原设备匹配证书 DER 指纹，以及证书和 profile 文件 SHA-256。
- 模板列出的五个官方工具入口的原有文件大小和 SHA-256。应取自已验证的本机基线，不能为了放行失败而自动采纳当前文件。

本机配置仅保存路径和公开摘要，不接受密码字段。密码仍由原加密配置经匿名 stdin 通道交给签名工具，不进入进程命令行。本仓库不包含本机配置、证书/profile、密钥、SDK、历史签名回执或真实发布请求。缺少有效本机配置时 `sign` 和 `inspect` 直接拒绝运行；模板本身不能签名。

`knownGoodReceipt` 兼容既有成功回执：需包含 `officialVerifyPassed`、`codeSignVerifyPassed`、`deviceSignerMatches`、`deviceCertificateFingerprint`、`signedSha256`、`allOriginalPayloadEntriesUnchanged`。该回执只证明原证书曾匹配设备，不代替本次正式请求和验收。

## 每次 App 发布

在仓库外复制 `SIGNING-REQUEST.template.json`，填入现有 native 构建输出的路径、完整身份和未签名 HAP 摘要。`identity` 完整取自本次 `public/build-identity.json`；本次确为要签名的正式冻结产物时，状态为 `ROOT_FINAL_FROZEN_PHONE_SIGNING`。

在仓库根目录调用，三个变量均为本次实际绝对路径，结果的父目录须已存在：

```powershell
python -B tools/harmony-release/sign_final_phone.py sign --config "$signingConfig" --request "$signingRequest" --result "$signingResult"
```

无需先运行 `check` 或 `inspect`。`check` 是可选 dry-run，按需使用且不需要 `--config`；`inspect` 仅用于签名环境排障。已有结果不覆盖，失败不自动重试。

版本来自请求的 `identity.versionName` 和 `identity.versionCode`，并与冻结清单、源身份、原生回执、HAP 内身份一致。例如 `0.4.5 / 20060` 输出 `lantern-0.4.5-20060-signed.hap`，放在受保护输出根的独立 `phone-20060-*` 目录。包名保持 `com.lantern.toeic`，API 基线保持不变。

为兼容现有 native 构建，本入口仍消费冻结清单和三份构建回执，且签名前仍核对冻结源码、Shared 和 HAP 内容。这里简化的是版本锁、工具目录复制和外部重复 `check`；没有声称旧清单或所有完整性检查已经取消。后续 builder/verifier 的版本参数化不属于这个签名入口。

成功结果包含本次身份、未签名/已签名 SHA-256、官方验签和签后载荷检查。QA、PM 和交付步骤引用同一结果，不因交接再次签名。结果只证明所列签名校验，不代表产品功能或手机验收。

## 源码与定向验证

`support/direct-sign.cjs`、`CredentialPipe.java`、`secure_files.py` 保留已有匿名密码通道、Windows 只读句柄与 ACL 校验；`public_core.py` 仅抽取它们使用的六个通用函数，未带入历史版本默认值。`SUPPORT-PINS.json` 只固定这四个源码依赖的摘要，官方工具摘要属于本机配置。运行时核对九个入口文件，不扫描 SDK/依赖树；这是完整性核对，不是给工具签名。

仅改本工具时，在此目录运行：

```sh
python -B test_verify_request.py
python -B -m unittest test_entrypoint test_signed_payload
```

测试可在 Linux 或 Windows 运行，仅使用临时合成 ZIP 与 mock，不读取真实签名材料、不调用 SDK、不签名、不操作设备。包含下一 buildcode/版本、配置缺失/错误、正式状态、包名/版本一致性和签后载荷保护。普通产品变更且工具未改，无需重跑这个工具矩阵。

# 官方主题素材下载入口核查

核查日：2026-09-08。范围：官方 Hollow Knight / Hollow Knight: Silksong 网站、Team Cherry FAQ、其直接链接的公开 Google Drive Press Kit。

## 结论

两个官方媒体包确实包含角色透明图、场景截图和主视觉；已读取公开目录并确认文件 ID。已确认小骑士、Hornet、丝歌竖版和横版主视觉的原始下载 URL。这里是来源及下载入口核查，没有下载、改作或向 GitHub 复制图片本体，也没有授予其 App 使用许可。

官方下载入口与第三方 App 使用权是两件事。官网将 Press Kit 面向撰写游戏报道的人；FAQ 对原创游戏视频/直播提供许可，对部分原创周边作有限许可，并明确排除在周边中使用其官方角色图、壁纸和营销图。没有找到覆盖第三方学习 App 主题、AI 改作、开源仓库再分发的通用许可。非盈利不能自动填补这一许可范围。以上是对公开条款的范围核对，不把“未发现 App 许可”写成“所有个人参考下载均违法”。[Team Cherry FAQ](https://www.teamcherry.com.au/faq)

## 两个官方媒体包

- [Hollow Knight 官网](https://www.hollowknight.com/)直接链接：[Press Kit (Hollow Knight)](https://drive.google.com/drive/folders/1SPCRaalJJepKYOQ4fdxZEzqNukJiUQCo)。包含角色宣传图、角色精灵图、截图、Grimm Troupe、动画和预告片目录。
- [Silksong 官网](https://hollowknightsilksong.com/)直接链接：[Press Kit (Silksong)](https://drive.google.com/drive/folders/1VE_YoUA36IwZRHnZhvEGUhqgU2GIEm4y)。包含角色宣传图、截图、超宽截图、竖/横版主视觉等。

公开目录读取均 HTTP 200，无账号、无访问绕过。web 文本读取器对 Drive 只显示输入框；直接读取公开目录 HTML 的可见文件表成功。根目录 22 项与 25 项为本次可见数量，不声称整个包穷尽或全部是图片。

## 已核实原始下载 URL（不是缩略图）

从下面四个文件公开查看页的下载元数据提取。查看页均 HTTP 200；下载 URL 未实际请求图片数据。大小为查看页声明的原始文件字节数。像素尺寸须在许可明确并实际下载后再验证，不能因为名称 Original/4k 就推定分辨率。

| 文件 | 查看页 | 原始下载 URL | 声明字节数 |
|---|---|---|---:|
| char_knight.png | [官方文件页](https://drive.google.com/file/d/1k3FSs12QYYDod-xGw_woI5KuqTOSMCUS/view) | https://drive.usercontent.google.com/uc?id=1k3FSs12QYYDod-xGw_woI5KuqTOSMCUS&export=download | 213610 |
| hornet_large.png | [官方文件页](https://drive.google.com/file/d/1wf2gBtOZE-b7lIJzTtxmSdIeCWzJe-I8/view) | https://drive.usercontent.google.com/uc?id=1wf2gBtOZE-b7lIJzTtxmSdIeCWzJe-I8&export=download | 828155 |
| Key Art Portrait Original.png | [官方文件页](https://drive.google.com/file/d/1k8ymQ6Wf2YFSV4YFg9DjVYq3ITktYUiX/view) | https://drive.usercontent.google.com/uc?id=1k8ymQ6Wf2YFSV4YFg9DjVYq3ITktYUiX&export=download | 15745781 |
| Key Art_wide_with_logo.png | [官方文件页](https://drive.google.com/file/d/1opXKZA79pb0rZRQbnZ-0muKuAi38fd0i/view) | https://drive.usercontent.google.com/uc?id=1opXKZA79pb0rZRQbnZ-0muKuAi38fd0i&export=download | 17908522 |

## 角色 / 场景 / Boss 的具体文件入口

下表文件名与 ID 已从官方包可见目录读取；单个文件查看页未全部打开。网址按 Drive 文件 ID 构成。这里保留原文件名，避免未经视觉核查就把内部名称映射为错误的正式 Boss 名称。

### hollow-characters

[官方子目录](https://drive.google.com/drive/folders/1edIKwseJidG4DtPUd5A3tcC9IEB6ccb-)，HTTP 200。

| 文件名 | 文件页 |
|---|---|
| boss_black_knight.png | [打开官方文件](https://drive.google.com/file/d/18AWjKbmFJCCXFVPViHAHC2bXujznLYeP/view) |
| boss_broken_wanderer.png | [打开官方文件](https://drive.google.com/file/d/16S0eoznVX2odk7bXrHZJ7d8KYKTSdoiD/view) |
| boss_brooding_mawlek.png | [打开官方文件](https://drive.google.com/file/d/1BXLlex_ySgz5QstwbXgAZWUS8WSzJjHv/view) |
| boss_dung_defender.png | [打开官方文件](https://drive.google.com/file/d/14VRNakCPR5P6WF7-BpVJrtmEhayl01l4/view) |
| boss_false_knight.png | [打开官方文件](https://drive.google.com/file/d/1dhP5DLVfkd24pGZ4jHhTwuubHrqx7NPR/view) |
| boss_hornet_02.png | [打开官方文件](https://drive.google.com/file/d/1eV9HgWu1cvaw2ug7A-MvWo1i19VluTe3/view) |
| boss_hornet.png | [打开官方文件](https://drive.google.com/file/d/1SY_EXcxXITEIhfWPaCoTHw6YAurBnBGV/view) |
| boss_mantis_lords.png | [打开官方文件](https://drive.google.com/file/d/1e4c_3dqFtNpS7m3O38sugWMc__Iuhwk2/view) |
| boss_soul_master.png | [打开官方文件](https://drive.google.com/file/d/1uqoNoDy8dTIbP9hBZPJUgXOVqpt6K_is/view) |
| char_knight_action.png | [打开官方文件](https://drive.google.com/file/d/1Hw5mRAx32oF_pbMyKi42E2rs_Sf0daVK/view) |
| char_knight.png | [打开官方文件](https://drive.google.com/file/d/1k3FSs12QYYDod-xGw_woI5KuqTOSMCUS/view) |
| char_knightling.png | [打开官方文件](https://drive.google.com/file/d/1KIz8HV6hc8ZsJBaZJgZ6mMuGES8yN-6h/view) |
| char_shade.png | [打开官方文件](https://drive.google.com/file/d/16j5uLfiEUohUAJaJ3cVVtTIakW-gsgZd/view) |
| city_of_tears_enemies.png | [打开官方文件](https://drive.google.com/file/d/1G5VpyVfVaxdGgaR4enPCZrJGZEVtgP8R/view) |
| knight_godmaster.png | [打开官方文件](https://drive.google.com/file/d/1jz31Ua7eOVgoUoxSOxHCX9aRVPOoVMmY/view) |
| npc_bertha.png | [打开官方文件](https://drive.google.com/file/d/1wSsUmXJER1bO3KUkU-4fCMfA46ymdL86/view) |
| npc_cloth.png | [打开官方文件](https://drive.google.com/file/d/1L70koApRYD9J-hf5DculLg1ncWlTuFwn/view) |
| npc_elderbug.png | [打开官方文件](https://drive.google.com/file/d/1NZhG2WqkxQGigfVqcMKGtbGWC1X-YJgQ/view) |
| npc_grubfather.png | [打开官方文件](https://drive.google.com/file/d/156cXQrwOQYNQ91HRJZK5oCQLZzG1x96w/view) |
| npc_mapper.png | [打开官方文件](https://drive.google.com/file/d/1KyhmnHm2TicdtfmkU_pV6LtAgE6UVxOH/view) |
| npc_nailmaster.png | [打开官方文件](https://drive.google.com/file/d/114-odYT77x5Eov8hTlAkeh-qS-ef3Ilt/view) |
| npc_nailsmith.png | [打开官方文件](https://drive.google.com/file/d/1AozXyRVbKbn2AQAxij0ckbtQnBoDewQB/view) |
| npc_quirrel.png | [打开官方文件](https://drive.google.com/file/d/1agvX9yZ7yw3MU86CvHw7IhL4Wecr07Ds/view) |
| npc_zote.png | [打开官方文件](https://drive.google.com/file/d/1yRzrEU_zU5mdxV34SVf3UFf09zsUody_/view) |

### hollow-screenshots

[官方子目录](https://drive.google.com/drive/folders/1pbff5vOu-IE55URJ642F9hK45pocQA2j)，HTTP 200。

| 文件名 | 文件页 |
|---|---|
| Blue_Cave.jpg | [打开官方文件](https://drive.google.com/file/d/1dC5giGdhL4kNkeoMlTYEMu9N5mmAZYMu/view) |
| City_of_Tears.jpg | [打开官方文件](https://drive.google.com/file/d/1BCyebIDBI_HeoLuerRwi6GQkbrSqkP1P/view) |
| city_royal.jpg | [打开官方文件](https://drive.google.com/file/d/1OlVodktoE2Vo75OXFkM3hyll7GoVCm2H/view) |
| colosseum.jpg | [打开官方文件](https://drive.google.com/file/d/1sSfoFdOyw_nvh_9r6DntrzyQF7Au6NqN/view) |
| Crossroads Entrance.jpg | [打开官方文件](https://drive.google.com/file/d/1u3icmSMlE_9ytZ0kpBjygYPeW74immji/view) |
| dirtmouth.jpg | [打开官方文件](https://drive.google.com/file/d/1bcTf8WDqIB87N4-Xu6dJT92zzx90WlvN/view) |
| False_Knight.jpg | [打开官方文件](https://drive.google.com/file/d/1vZeDmyslS9ubJXGtLCZ25ZL5vAPRd-wy/view) |
| false_knight(1).jpg | [打开官方文件](https://drive.google.com/file/d/1xIjWmJikbkEq3h4ojZ-au7SBGqXgyr1Y/view) |
| Grimm Tent.jpg | [打开官方文件](https://drive.google.com/file/d/1TOq7bTUvUoGnf-_1SiawDrg8xmYOWTg-/view) |
| Grimm.jpg | [打开官方文件](https://drive.google.com/file/d/1pvd0aMgL2e20o32HlBUYFhpATLCX0yYB/view) |
| HK_screens_0012_The_Abyss.jpg | [打开官方文件](https://drive.google.com/file/d/1szYJykNWq6eNRGwg4JU0_4OuHu05Llxf/view) |
| Lake_of_Unn.jpg | [打开官方文件](https://drive.google.com/file/d/11G0crNdYaWpuT8gPAK2qZlE89YCwq822/view) |
| mines.jpg | [打开官方文件](https://drive.google.com/file/d/1a8EbkxXPWMht3vA3sduX0OJJER1_sZHS/view) |
| Moss_charger.jpg | [打开官方文件](https://drive.google.com/file/d/1c3MVCXzIaqGWVL_5y4H3rsMWjksr9Qo-/view) |
| new_city_shot.jpg | [打开官方文件](https://drive.google.com/file/d/1Q5fgxcOEow0TlLFUhzPTOvmgxv1Bmsu_/view) |
| Paintmaster.jpg | [打开官方文件](https://drive.google.com/file/d/1usYJf-sGEMzRsCiyiA1MVdWFNZx6oRd2/view) |
| quick_map.jpg | [打开官方文件](https://drive.google.com/file/d/10hAiPJbr66js5UxHr7k2w3pDXa66KtgX/view) |
| relic_dealer.jpg | [打开官方文件](https://drive.google.com/file/d/1I4N9Oct2zG6k-GQJ7Mpsq6YXc3GRiX5l/view) |
| screen_charms.jpg | [打开官方文件](https://drive.google.com/file/d/1LZLQGM1Njl0sZ8MYxj3KQlT_oOxYUkIe/view) |
| Screenshots_Hi_res_0007_6.png | [打开官方文件](https://drive.google.com/file/d/1gfqCov_KXu_mPEBmIoNimiEWLDIao9tj/view) |
| Screenshots_Hi_res_0008_5.png | [打开官方文件](https://drive.google.com/file/d/12nElH_IYcelc-inghnoTcHqeuJDxVdoK/view) |
| Shade_Beast.jpg | [打开官方文件](https://drive.google.com/file/d/1vVDQs5dAZkY9LZF43m17fz3G8m_ALFlL/view) |
| Teacher.jpg | [打开官方文件](https://drive.google.com/file/d/1UFV1TWKJqposs7qSDveQtAy7_tijTNNO/view) |
| The Hive.jpg | [打开官方文件](https://drive.google.com/file/d/1izeg1i7VFnIm4BqMZe6eGuhlU3TKtgZL/view) |
| white palace.jpg | [打开官方文件](https://drive.google.com/file/d/1halfO4DWP6Gw1WKTbDjVBVbsUdufmtp5/view) |

### hollow-grimm

[官方子目录](https://drive.google.com/drive/folders/1Y4-O1natXk3w-674k4g2dXxLe5JdX6qd)，HTTP 200。

| 文件名 | 文件页 |
|---|---|
| Grimm_Troupe_A1.png | [打开官方文件](https://drive.google.com/file/d/1Nc31coOMjXBUMPzJS32koUcrtyGHgfZg/view) |
| Grimm_Troupe_flyer.png | [打开官方文件](https://drive.google.com/file/d/1B3aYpmXnF8tdE1fOhcrVru9TWy_ExKNd/view) |
| Grimm_Troupe_Poster.png | [打开官方文件](https://drive.google.com/file/d/1pOB8bwCjQn5JMqMUIdf54oLF35fAkFAP/view) |
| Grimm_troupe_screen.png | [打开官方文件](https://drive.google.com/file/d/1scQPgHeC4E1W-oVNqPSPqFPJUsIVyeFa/view) |

### silk-characters

[官方子目录](https://drive.google.com/drive/folders/1gjCKkQww45JAWMvmUXsbODrr-90Jw7pP)，HTTP 200。

| 文件名 | 文件页 |
|---|---|
| boss_hunter_queen_carmelita.png | [打开官方文件](https://drive.google.com/file/d/1V4yYTg-vNyrVvV3PM2qRltfm8PjEg0gA/view) |
| boss_lace.png | [打开官方文件](https://drive.google.com/file/d/1CPBT8iH1_C52M4UjZLUa1EUgX0r3Pp_m/view) |
| boss_phantom.png | [打开官方文件](https://drive.google.com/file/d/1PwjaF_3636FLi0_BTfYHJqx-7DsuJa1o/view) |
| boss_trobbio.png | [打开官方文件](https://drive.google.com/file/d/1kAWF2crekM6gsv1gjhvTJvfhVmNBj4vk/view) |
| hornet_large.png | [打开官方文件](https://drive.google.com/file/d/1wf2gBtOZE-b7lIJzTtxmSdIeCWzJe-I8/view) |
| npc_chapel_maid.png | [打开官方文件](https://drive.google.com/file/d/1_BPJbkhSnG_cUW_l9lnzANftwIlEo15L/view) |
| npc_fleas.png | [打开官方文件](https://drive.google.com/file/d/1XGuDuFloNN5hn79vOVCi2D2JTcT7cJ6X/view) |
| npc_forge_daughter.png | [打开官方文件](https://drive.google.com/file/d/1voDbPW15IyEhLEkRg16Qo-Ct_XyxG8eF/view) |
| npc_garmond_and_zaza.png | [打开官方文件](https://drive.google.com/file/d/1eGNmKnXDzAEhuBg5-qkS9Beafj7YzUTo/view) |
| npc_grindle.png | [打开官方文件](https://drive.google.com/file/d/1wGi6q8hOaUnHNzS1eZ33MXpP1UFxdJzK/view) |
| npc_huntress.png | [打开官方文件](https://drive.google.com/file/d/1JbuBtgZhJaoW9eB_EUGnbDVDKZlnySv0/view) |
| npc_nuu.png | [打开官方文件](https://drive.google.com/file/d/1rCuC5xLCm3OIKGNui3OhUY7pIPtgd4Sl/view) |
| npc_shakra.png | [打开官方文件](https://drive.google.com/file/d/1IhIA3LzllgopPexUA5dDxDy-cmpC-JV9/view) |
| npc_sherma.png | [打开官方文件](https://drive.google.com/file/d/1Ae5aeHg1cmdpBTbCfQ-hcZVpZUepXuFZ/view) |
| npc_shrine_guardian_seth.png | [打开官方文件](https://drive.google.com/file/d/1hyw3_U4-K8c6_B6IanA0dAd3LuhiGXno/view) |

### silk-screenshots

[官方子目录](https://drive.google.com/drive/folders/12-80w1sEwXid1gYvJI4BAJC2PhM05Idf)，HTTP 200。

| 文件名 | 文件页 |
|---|---|
| Ultrawide | [打开官方文件](https://drive.google.com/drive/folders/1u_iGmmgFgWo6h1ztmRlR-4ZpeiARsEFN) |
| 01_grotto.png | [打开官方文件](https://drive.google.com/file/d/1iZKMyc2feFF2l_0Ljv2NpuqPyJJeXKiq/view) |
| 02_coral.png | [打开官方文件](https://drive.google.com/file/d/1zwYmAzTEjvnaxPFT6I51KEBR3ocsnF2x/view) |
| 03_chambers.png | [打开官方文件](https://drive.google.com/file/d/1qk_ThFDIVZk_8hb2GXPIMtMZ-rJRp7ck/view) |
| 04_chorus.png | [打开官方文件](https://drive.google.com/file/d/1ELeDHr9aPNjwhkPIazvLNp3fN38SLXWI/view) |
| 06_greymoor.png | [打开官方文件](https://drive.google.com/file/d/1fO5mBm0g75jlaxpHQspcJ3OT5tZPaP1I/view) |
| 07_clover.png | [打开官方文件](https://drive.google.com/file/d/1Ru9WXnq4XiskiXUtRKONgYiHtFLJMsNz/view) |
| 08_bellhart.png | [打开官方文件](https://drive.google.com/file/d/1uV7IyrB8nZ8GxxmNVeJ9Ir2EkUDiAwrW/view) |
| 09_volt.png | [打开官方文件](https://drive.google.com/file/d/1Oy0VXCpVeOiHTvzUy6RMKBIa4jeWbCcF/view) |
| 09a_peak.png | [打开官方文件](https://drive.google.com/file/d/19yCQ-FCFbEvl2yGI3tFm_CH3a1N_GOBw/view) |
| 010_bellbeast.png | [打开官方文件](https://drive.google.com/file/d/16Z5ECq2e0TeBQr-GZh9m2OSQp4URs6cx/view) |
| 11_lace.png | [打开官方文件](https://drive.google.com/file/d/1rMCAdPI6gvlCSrbVLVHGl3X3Ek1hueVa/view) |

## 官网可直接访问的图文件

以下地址已在仓库的同日研究中由官网 HTML 确认；本次重新打开两官网，确认相应图名仍列在页面。像素值来自官网 HTML 的 data-image-dimensions，并非本次解码文件所得。仅把 1920×1080 称为 1080p，2560×1440 称为 1440p；595×335 不是高清。

| 文件 | 像素元数据 | 官网图文件 URL |
|---|---:|---|
| Hollow Knight — 官方主视觉 HK_header.jpg | 1300×740 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/7dc1dbea-b5fc-4c8f-8768-1a5c3ede53e3/HK_header.jpg |
| Blue Cave — 官方场景截图 | 1920×1080 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/6cdafaab-e95a-49c7-a045-4f21469bb327/Blue_Cave.jpg |
| Mines — 官方场景截图 | 1920×1080 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/3d8baa3e-5b8a-4c13-9747-4e89fb6ed0e6/mines.jpg |
| Lake of Unn — 官方场景截图 | 595×335 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/1617763599729-KB821M5EQA818FABUXO3/lake_of_unn.jpg |
| False Knight — 官方 Boss 截图 | 595×335 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/1617763465032-T3M2QQ4KMOTWS3EW7FC8/false_knight.jpg |
| Grimm — 官方 Boss 截图 | 1920×1080 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/3d24e1c8-d368-4b05-bb5f-00888e238d12/Grimm.jpg |
| Paintmaster — 官方 Boss 截图 | 1920×1080 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/aae3d1c6-1590-4b86-a56b-e8efcc543b6b/Paintmaster.jpg |
| White Palace — 官方场景截图 | 1920×1080 | https://images.squarespace-cdn.com/content/v1/606d159a953867291018f801/64008652-cc73-42e3-a001-b65f33c0471b/white+palace.jpg |
| Silksong — 官方主视觉 new-bg.jpg | 1200×675 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/1b547f53-e6f9-461e-b9df-0104e04726b5/new-bg.jpg |
| Grotto — 官方场景截图 | 2560×1440 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/5b2edc7f-750c-4bcf-9216-e0cac388a585/01_grotto.png |
| Coral — 官方场景截图 | 2560×1440 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/d715d8b6-a0c0-4c48-a405-504f753809df/02_coral.png |
| Peak — 官方场景截图 | 2560×1440 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/2998be3f-3d43-4a34-b005-defe3159ae8c/09a_peak.png |
| Chambers — 官方场景截图 | 2560×1440 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/4d780799-09ac-4678-980b-e3f8d6a9ffdf/03_chambers.png |
| Greymoor — 官方场景截图 | 2560×1440 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/fcf2e48f-017f-4d53-bb91-6a130b07d8bb/06_greymoor.png |
| Lace — 官方 Boss 截图 | 2560×1440 | https://images.squarespace-cdn.com/content/v1/606d4bb793879d12d807d4c8/c5a909b7-cf12-4f86-916c-1fbe4e37ed7d/11_lace.png |

## 建议的入库状态

1. 官方 Press Kit：保存来源、原文件名、文件 ID、下载 URL、原始尺寸核验状态与许可状态；目前 `app-use-pending`，不能改成 `approved-for-app`。
2. Fan art：原作者作品页并不等于授权下载和 App 使用；尚未取得许可的作品继续只索引原作者。
3. 当前主题可使用仓库已有原创图继续做 AI 衍生，保存实际图文件、提示词、派生关系、尺寸、SHA-256 和网页/手机裁切用途；授权明确的文件再进入发布包。
4. 要把官方角色放入可分享的学习 App，需额外许可说明覆盖复制、裁切/AI 改作及 Web/原生分发。不要向用户宣称“非盈利所以可任意使用”。

## 本次证据文件

- official-presskit-file-index.json：两个媒体包顶层可见目录元数据。
- official-presskit-subfolders.json：5 个角色/场景/Boss 子目录元数据，共 80 个可见条目，其中 1 个是 Ultrawide 子目录。
- official-presskit-download-links.json：4 个查看页核实的原始下载 URL 与声明大小。

没有更改项目 checkout。没有下载版权图片本体，也没有发出对外联系消息。

# Changelog

## 0.9.5 - 2026-11-28

- **模型中枢真实流式 `tok/s` 测速校准、混淆 ID 自动解码、地域路由 `400` 容灾降级与批量进度测速（[model-hub.mjs](plugin/server/model-hub.mjs) / [prism-profile.mjs](plugin/server/prism-profile.mjs) / [account-vault.mjs](plugin/server/account-vault.mjs) / [index.mjs](plugin/server/index.mjs) / [app.html](plugin/ui/app.html)）**：
  - **首字后真实流式解码吞吐率统计**：`probeModelSpeed` 升级为纯流式多块采样，当上游未回传显式思考字符时剔除首字前隐藏推理 Token 虚高干扰，自动过滤 `> 450 tok/s` 代理缓冲假象与单 Token 失真，并放宽思考模型测速预算以防 `502 unexpected EOF`；
  - **发现模型自动解码与批量进度测速**：`classifyDiscoveredModel` 自动反转还原 `claude-fable-5-dd-*` 混淆模型名（含 `/waP-IPA2buS` 备用路由后缀识别）并过滤生图端点（`isChat: false`）；「发现模型」搜索与全选支持原名/解码名分隔符不敏感双向匹配；工作台顶栏升级为可显示实时进度与单击中止的 `⚡ 批量测速`（默认测收藏模型，`Shift+点击` 测全部启用模型），批量导入按梯队自适应分配 `16384 / 8192` 输出上限；
  - **瞬态地域/号池 `HTTP 400` 单跳降级、编排保序与双端凭据互通**：`isFallbackEligibleError` 白名单放行上游地域路由瞬态 `400`（如 `User location is not supported`）自动切备用线路，同时严格拒绝对 `safety / content_filter` 静默降级；`listModelsForMcp` 保留 `prism-profile.json` 主备编排顺序（修复 `-backup` 字母序排在主力前的问题）；`prism_ask_model` 默认 `165s` 超时早于宿主 `180s` 硬断连并补齐 JSON-RPC 错误兜底；`account-vault.mjs` 打通同机 Windows 与 WSL 双命名空间密钥互读。
- **输入框 `Tab` 真 AI 续写预测闭环、隐藏节点防误拦与底栏 `tok/s` 动静双态胶囊（[daemon.mjs](vendor/anti-claude/core/daemon.mjs) / [prism-suite-fx.js](extensions/prism-suite-fx.js) / [prism-suite-fx.css](extensions/prism-suite-fx.css)）**：
  - **三协议 + 系统保险箱 + `T4` 极速模型优先预测**：`predictNextPromptAction` 完整打通 `anthropic-messages`、`openai-chat` 与 `openai-responses` 三协议及系统凭据库惰性读取，严格优选非思考 `T4/T3` 快模型（`flash-lite / flash` 优先、同网关前 2 款快模型顺延重试，绝不误调 `T1` 重型旗舰），内置 64 条会话级 LRU 缓存与 `45s` 失败退避；
  - **修复隐藏 `listbox` 吞 `Tab` 与回复内嵌 `<style>` 污染**：`hasVisibleComposerPopup` 增加真实可见尺寸（`> 8px`）校验以排除宿主常驻 `0×0` `<div role="listbox">` 误拦截；`extractCleanMessageText` 优先读取 `[data-testid="agent-response"]` 并剥离内嵌 `<style>` 源码与思考块，改按对话内容签名刷新预测以免疫长对话虚拟滚动；
  - **底栏实时速率胶囊动静分离**：生成期间高亮显示 `⚡ N tok/s · TTFT ...`，任务停止或完成后自动转为柔和静息态 `上轮 N tok/s · TTFT ...`（悬停卡片同步标注当前状态）。
- **CUA 纯截图跳过控件树显式提示、思考翻译 UTF-16 Emoji 无损切块与上游基线同步（[plugin-cua/server/index.mjs](plugin-cua/server/index.mjs) / [daemon.mjs](vendor/anti-claude/core/daemon.mjs) / [sync-version.mjs](scripts/sync-version.mjs) / [upstream.json](upstream.json)）**：
  - **`cua_observe` 支持 `includeTree: false` 纯截图极速观察**：跳过桌面 UIA / 网页 DOM 遍历时保留既有 `@wN/@eN` 观察缓存不被空树覆盖，并在返回块显式输出 `[includeTree=false]` 跳过说明，防止模型误判窗口为空；
  - **思考双语翻译 UTF-16 代理对与占位符无损分块**：新增 Clean-Room `clipUtf16Safe` 并升级 `splitTextForTranslation`（`900` 单元上限），确保绝不在 Emoji 高低代理项（`0xD800..0xDFFF`）或 `⟪P…⟫` 代码保护占位符中间硬切，同时拒绝纯空白译文回包；修正 `sync-version.mjs` 对 `plugin-cua` 冻结头部的版本同步并推进全部上游监控基线归零。

## 0.9.4 - 2026-11-28

- **输入框 `Tab` 下一步提问建议零重影、单次防重填入与模型中枢正式打通（[prism-suite-fx.css](extensions/prism-suite-fx.css) / [prism-suite-fx.js](extensions/prism-suite-fx.js) / [daemon.mjs](vendor/anti-claude/core/daemon.mjs)）**：
  - **根除原生占位提示语叠字重影**：以双倍输入框 ID 选择器精准锁定 `data-lexical-placeholder="true"`（覆盖防发虚规则的 `opacity: 1 !important`），在建议显示期间强制 `opacity: 0` 与 `visibility: hidden` 双重隐藏；
  - **修复按一次 `Tab` 重复填入两遍 + 支持鼠标点击 `Tab` 胶囊**：新增 `350ms` 单次触发防重锁并适配 Lexical 异步微任务渲染时序，彻底消除同步兜底引发的双写翻倍；新增 `✦` 建议微标、鼠标直点 `Tab` 标签一键填入及中文输入法首键零闪烁退让；
  - **打通工作台 `prism-profile.json` 智能预测与末尾结论优先启发式**：修复守护进程此前未读取 `prism-profile.json` 网关配置的问题（附安全环境变量白名单、出站凭据脱敏与 IPv6 映射 IMDS `[::ffff:a9fe:*]` 拦截），同时优化本地启发式聚焦助手回复末尾最新结论。
- **文件工作台非 UTF-8（GBK/GB18030）防写坏保护、能力令牌鉴权、集中脱敏与保险箱防丢备份（[index.mjs](plugin/server/index.mjs) / [redact-shared.mjs](plugin/server/redact-shared.mjs) / [account-manager.mjs](plugin/server/account-manager.mjs) / [handoff-memory.mjs](plugin/server/handoff-memory.mjs)）**：
  - **GBK / 本地编码只读预览防乱码损坏 + UTF-8 BOM 保留**：对非 UTF-8 文本文件自动按 `GB18030` 解码清晰预览并锁定只读提示（服务端同步硬拒覆写），对带 UTF-8 BOM 文件完整保留 BOM 头；
  - **服务端 256-bit `_appToken` 能力令牌 + 工作台危险动作二次确认 + 跨帧桥收紧**：所有 `visibility: ["app"]` 内部管理工具在 stdio 通道强制校验仅注入 UI 资源的随机令牌，删除凭据备份/网关/记忆、一键自更新与开启 CUA 统一增加双次点击防误触确认，工作台 `postMessage` 桥严格校验宿主真实挂载 `<iframe>` 并移除邮箱广播；
  - **`show_files_inline` 防外部 SMB/NTLM 泄露 + 集中脱敏矩阵 + 远程记忆污点隔离**：补齐内联文件卡片外部 UNC 拦截与 `open_prism_files` 敏感目录保护；新建 `redact-shared.mjs` 统一覆盖四端凭据脱敏（含思考翻译出站前自动脱敏）并扩充 `.kube`/`.docker`/`.azure`/`gcloud`/`oauth_creds.json`/8.3 短文件名及 Shell/MCP 配置写保护；切号遇极端回滚失败时强制保留自动捕获备份槽防丢号；外部远程记忆标记 `[EXTERNAL_UNTRUSTED_MEMORY]` 并加 JSONL 跨进程文件锁。
- **电脑操控（CUA）默认零驻留、全程常驻 `Esc` 急刹、物理键盘前台锁与对称干净卸载（[cua-broker.mjs](vendor/anti-claude/core/cua-broker.mjs) / [PrismWinCua.cs](native/win-cua/PrismWinCua.cs) / [prism-suite.js](extensions/prism-suite.js) / [install.mjs](install.mjs) / [uninstall.mjs](uninstall.mjs) / [PrismSuiteInstaller.cs](installer/win/PrismSuiteInstaller.cs)）**：
  - **CUA 按需唤醒零常驻 + 全程无盲区 `Esc` 急刹 + 严禁模型越权改鼠标档位**：`prism-cua` 默认关闭期间后台不启动 Broker、零端口监听、零令牌落盘，且 WSL 网卡严格限定 `WSL` 虚拟接口；开启操控后由常驻悬浮层与受控网页同步监听物理 `Esc` 键并配合单调递增 `leaseEpoch` 清空排队指令；严禁模型参数突破用户设定的 `strict_virtual` 零触鼠上限；
  - **L4 物理打字逐段前台窗口校验 + 忙时礼让回退 + 截图遮挡防泄密**：物理输入前与每 8 字符/回车制表前强制核验 `GetForegroundWindow()` 根句柄防止切屏误敲入终端，用户忙时超时返回 `USER_BUSY_YIELD`，截图回退前执行 9 点遮挡检测防拍入受保护窗口，观测快照按窗口/标签页隔离并附随机边界防伪 ID；
  - **84 天热力图完整账本、异步 WSL 探测、快捷键避让与对称卸载**：修复 14/84 天共享缓存截断问题，思考翻译增加跳过记忆与指数退避，WSL 探测改为纯后台异步，`Alt+Shift+↑/↓` 自动避让 Monaco/终端编辑器；安装写入 `.prism-managed` 防误删用户同名目录、固定 `System32\wsl.exe` 防劫持，卸载完整清理 `install-mode.json`、Native Messaging 注册表项与快捷方式调试参数（支持 `--purge` 清空备份凭据），并新增 `ci.yml` 双系统自动门禁与 `scripts/sync-version.mjs` 全仓版本一致性校验。

## 0.9.3 - 2026-11-28

- **内置 `Anti-Claude v3.1.10` 内核升级适配 `Antigravity v2.36.0` + 思考过程防误翻双语翻译增强（[daemon.mjs](vendor/anti-claude/core/daemon.mjs) / [custom.js](vendor/anti-claude/user/custom.js) / [i18n.json](vendor/anti-claude/core/i18n.json) / [prism-suite.js](extensions/prism-suite.js) / [prism-suite.css](extensions/prism-suite.css)）**：
  - **同步 `Anti-Claude v3.1.10` 与 `agy-powertools v2.17.0` 基线**：完整兼容 `Antigravity v2.36.0` 模型选择菜单新增的 `hideThinkingEffort` 推理强度显隐控制，并补齐 `Context and quota indicator`、`Legacy Dark` 等新版宿主界面汉化词条；
  - **思考过程整句双语翻译、代码防误翻掩码与本地 `0600` 缓存**：翻译前自动将内联代码、文件路径、命令行标志与驼峰/下划线标识符替换为 `⟪P…⟫` 安全占位符（杜绝代码片段与路径被机器翻译破坏），使用 `0600` 权限持久化本地 `thought-translation-cache.json` 加速二次展开，并在将思考中译设为「关」时自动触发 `clearTranslateCache` 清空内存与本地缓存；
  - **视口按需懒加载与靠左对齐「原文 / 译文」一键切换**：仅对处于或接近当前视口的展开思考块发起翻译（配合滚动容器被动节流监听按需加载离屏思考块）；双语与沉浸模式统一采用左对齐工具头，分别支持 `仅看原文 / 恢复双语` 与 `查看原文 / 仅看译文` 无缝切换。
- **中文 `万 / 亿` Token 单位、小时级耗时进位与输入框 `Tab` 下一步提问建议（[prism-suite.js](extensions/prism-suite.js) / [prism-suite-fx.js](extensions/prism-suite-fx.js) / [prism-suite-fx.css](extensions/prism-suite-fx.css) / [custom.js](vendor/anti-claude/user/custom.js) / [account-manager.mjs](plugin/server/account-manager.mjs)）**：
  - **中文直觉 `万 / 亿` 数值单位与长耗时自动进位**：`✦ 棱镜 → ⚡ 效率` 新增 `Token 数量单位`（默认 `万 / 亿`，可随时切回 `K / M`），联动右侧概览、底栏上下文环、12 周热力图与名著体量换算实时刷新；步骤与思考耗时满 `60 分钟` 自动进位为 `X 小时 Y 分` 易读格式；
  - **实验性「输入框下一步提问建议」（`composerIntentSuggest`，默认关闭）**：零 `document.body` 观察器、纯内存零落盘（切换侧栏历史会话零后台请求）；仅在当前对话回复完成或主动点击空闲输入框时生成浅灰续写建议（自动隐藏原生占位提示防叠字），按 `Tab` 键一键填入输入框（绝不自动发送），中文输入法组词与打字即刻避让、同轮删空自动从内存恢复、按 `Esc` 键当轮静默关闭；
  - **跨账号切号偏好完整保留**：`sanitizePrismUiPrefs` 同步纳管 `composerBorderFx`、`outlineRailMode`、`outlinePreviewStyle`、`tokenUnit` 与 `composerIntentSuggest` 全部新增偏好。
- **实机界面体验细节深磨：套餐宝石徽章彩蛋、侧边面板与概览零空白共存、光学切面与气泡解耦、左栏预览互斥与全屏工作台返回修复（[prism-suite.js](extensions/prism-suite.js) / [prism-suite-fx.js](extensions/prism-suite-fx.js) / [prism-suite-fx.css](extensions/prism-suite-fx.css) / [app.html](plugin/ui/app.html)）**：
  - **套餐宝石徽章与点击三态切换彩蛋**：为 `ULTRA / PRO / TEAM / PLUS / STARTER` 账号渲染专属切面矢量宝石徽章，单击徽章即可在 `徽章 / 纯图标 / 纯文字` 三种形态间灵动切换，并跨主窗口顶栏控制中心与右侧工作台双向实时同步；
  - **侧边面板与概览零空白共存及残留自愈**：`保持右侧概览常开` 智能感知右侧辅助分屏（如工作台、终端或文件对比）开启状态以避免挤出空白占位，新增 `checkAndHealOrphanedOverviewTransition` 自动修复宿主切换卡顿遗留的半透明过渡态；
  - **光学立体切面与气泡着色彻底解耦 + 纯图片消息防误染 + 左栏预览互斥**：`光学立体切面` 精准排除无圆角外层 `changed-files-card` 容器且绝不改动用户提问气泡底色与边框；`用户消息气泡着色` 严格限定文字气泡节点（修复单发纯图片或附件时外层整行被误染蓝框的问题）；左栏激活轮次升级为 `16px` 竖向胶囊，新增 `悬停预览样式`（`详细卡片 / 精简胶囊` 严格二选一互斥，彻底消除双浮窗重叠）；
  - **全屏工作台返回对话沙箱域打通**：桥接白名单正式放行 Antigravity MCP App 沙箱域 `*.usercontent.goog`，修复全局宽屏工作台点击「`↩ 返回对话`」及双端实时主题/配额同步链路。

## 0.9.2 - 2026-11-28

- **全界面 8 套主题配色零闪烁互通 + 一键体验预设 + 双设置中心双向联动（[prism-suite.js](extensions/prism-suite.js) / [prism-suite.css](extensions/prism-suite.css) / [app.html](plugin/ui/app.html) / [inline.html](plugin/ui/inline.html) / [custom.js](vendor/anti-claude/user/custom.js)）**：
  - **主窗口、`Prism 工作台` 与 `内联文件卡片` 8 套棱镜主题同源同步**：新增 `PRISM_PALETTE_TOKENS` 与 `theme-sync` 实时桥接下发（配合本地缓存零闪烁冷启动），切换「纯白默认 / 白昼冷晶 / 暖白画册 / 松雾青岚 / 暖炭默认 / 深空黑曜 / 暖炭玄岩 / 深海墨蓝」时，右侧工作台与内联文件卡片的背景、边框、强调色实时同步变色，彻底告别割裂感；
  - **面向普通用户的「一键体验模式」与四分类直觉菜单**：在 `✦ 棱镜控制中心` 顶部新增 **`🕊 极简专注 / ✦ 灵动推荐 / 🌈 炫彩满血`** 一键切换胶囊，并将全部开关按产品直觉归入 **`🎨 外观 / ✨ 动效 / 🧭 导航 / ⚡ 效率`** 四栏页签，低频兼容项自动收纳入底部「高级与环境兼容选项」折叠区；
  - **双设置入口主从打通**：`✦ 棱镜` 顶栏新增 `全部设置 ⚙` 一键直达「设置 → 界面增强」，同时在「设置 → 界面增强」顶部提供引导卡一键返回并打开 `✦ 棱镜`。
- **全局浮窗互斥与统一卡片语言 + 全端去术语化降噪 + 安装器简洁首屏（[custom.js](vendor/anti-claude/user/custom.js) / [custom.css](vendor/anti-claude/user/custom.css) / [runtime.js](vendor/anti-claude/core/runtime.js) / [popup.html](extensions/chrome-cua-bridge/popup.html) / [PrismSuiteInstaller.cs](installer/win/PrismSuiteInstaller.cs)）**：
  - **全局浮窗互斥与层级对齐**：根治展开底栏额度卡时悬停右侧指标胶囊叠出双浮窗、或点击 `5h · 7d` 胶囊闪回的问题；统一所有浮窗与右键菜单为 `14px/12px` 圆角、顶边微高光、窄矮屏防裁切自适应材质，提升模型选择菜单层级（`99986`）并动态避让增高后的多行输入框；
  - **全端通俗中文清洗与工作台降噪**：浏览器受控扩展升级为带专属棱镜真图标的「Prism 网页协作助手」（一键「允许 AI 协助此网页」）；工作台「账号接力」将「✨ Prism Suite 一键更新」独立置顶，将项目槽位、记忆、组件开关与上游动态收纳进默认折叠的「🛠️ 进阶协作与维护」；Windows 安装器默认折叠复杂目录配置并在安装完成后给出清晰的三步上手指引。
- **输入框边缘光效三合一 + 120Hz/240Hz 纯 GPU 合成器流光 + 智能左栏去重 + 全主题光学切面增强（[prism-suite-fx.js](extensions/prism-suite-fx.js) / [prism-suite-fx.css](extensions/prism-suite-fx.css)）**：
  - **纯 GPU 合成线程流光边框（告别高速流式输出卡顿）**：移除旧版主线程每帧 84 次 Canvas `stroke()` 绘制，升级为 `mask-composite: exclude` 圆角边框遮罩 + 纯 `transform: rotate(360deg)` 合成器图层（`.ag-ps-beam-ring > .ag-ps-beam-rotor`），即使 Agent 以 `135+ tok/s` 高速输出阻塞主线程也能锁满显示器高刷零掉帧；同步将 `ThinkingOrb` 128 粒子合并为 4 桶批量 `fill()`；
  - **三合一 `输入框边缘光效` 与三态边缘余晖修复**：将「语义边缘余晖 + 流光边框 + 额度光环」合并为单一直观控件（`关 / 智能 / 常驻流光 / 纯静余晖` + 三阶段实机 `预览光效` 按钮），提升选择器权重并修复光标静止在输入框内导致完工余晖被瞬间误清的缺陷；
  - **智能左栏去重与全主题立体切面**：默认启用 `智能左栏` 识别原生左栏轮次导航并自动收起右侧重复圆点条（消除右滚动条抢点击及点开额度卡乱飞避让），同时为原生左栏圆点补上中文提问悬停预览；升级 `opticalFacets` 在全部 8 套深浅主题下的卡片切面高光、提问气泡微边与 `1px` 分屏光丝对比度。

## 0.9.1 - 2026-11-27

- **修复 Windows 安装器与 CUA 弹窗高分屏（150% / 200% / 250% DPI）布局裁切 Bug，并新增项目专属「光学色散水晶棱镜」多尺寸图标（[PrismSuiteInstaller.cs](installer/win/PrismSuiteInstaller.cs) / [prism-suite.ico](installer/win/prism-suite.ico) / [PrismWinCua.cs](native/win-cua/PrismWinCua.cs) / [build-win-exe.ps1](scripts/build-win-exe.ps1)）**：
  - **高分屏精确流式自适应重构**：启用 `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2` 并移除旧版 `AutoScaleMode.Dpi` 未设置 96 DPI 基准导致的「字号放大而窗体与顶栏锁死 96 DPI 物理尺寸」缺陷；顶栏改为自适应纵向流式网格（不再硬编码 `84px` 高度，彻底解决高分屏副标题拦腰截断），组件复选框与路径标签随窗口宽度动态计算 `MaximumSize` 自动折行（解决右侧裁切），窗体尺寸自适应当前显示器工作区并内置超小屏滚动兜底，确保「一键安装 / 更新」按钮与执行日志在任意缩放倍率与笔记本分辨率下开屏完整可见；同步对 `prism-win-cua.exe` 的受控授权确认窗与顶部状态胶囊完成同等高分屏缩放加固；
  - **专属光学棱镜多尺寸图标体系**：新增可复现矢量超采样生成的 7 帧标准图标 `installer/win/prism-suite.ico`（含 `16/20/24/32/48/64` 32-bit BGRA DIB 小尺寸笔画锐化帧与 `256` 高清 PNG 帧），通过 `/win32icon` 与内嵌资源同步注入 `Anti-Claude-Prism-Suite-Setup.exe`、`prism-win-cua.exe`、安装器与授权窗左上角标题栏、顶栏左侧抗锯齿光学徽章、工作台 [logo.svg](plugin/assets/logo.svg) 及 Chrome/Edge 扩展桥图标；
  - **WSL 目标探测加速与冷启动容错**：`DetectWslPluginTargets` 优先通过 `\\wsl.localhost\<distro>\home` 零进程开销直读已运行发行版，冷启动回退查询超时提升至 `5s`。

## 0.9.0 - 2026-11-27

- **免预装系统 Node.js 零门槛运行支持与 Windows 全链路杀软零误报卫生重构（[PrismSuiteInstaller.cs](installer/win/PrismSuiteInstaller.cs) / [ms-lnk.mjs](vendor/anti-claude/core/ms-lnk.mjs) / [install.mjs](install.mjs) / [daemon.mjs](vendor/anti-claude/core/daemon.mjs)）**：
  - **免装 Node.js 双击即用（`ELECTRON_RUN_AS_NODE=1`）**：Windows 安装器与跨平台安装链路在未检测到系统 `node >= 22` 时，自动回退复用本机 `Antigravity.exe` 内置 Electron Node 运行时（全链路子进程与开机自启脚本自动透传 `ELECTRON_RUN_AS_NODE=1`，无头静默运行不弹 GUI 窗口）；
  - **纯二进制 `[MS-SHLLINK]` 快捷方式编解码与 COM 原生化**：新增零依赖纯 Node 模块 `ms-lnk.mjs` 按微软公开二进制规范解析与无损修补 `.lnk` 参数（兼容注册表 `User Shell Folders` 重定位至 `D:\` 或 OneDrive 的桌面目录）；C# 安装器彻底移除 `WScript.Shell` 后期绑定反射，改用标准 `[ComImport] IShellLinkW` + `SHGetKnownFolderPath`，同时移除 `upstream-radar.mjs` 与 `relaunch-client.mjs` 中的 `-WindowStyle Hidden` 特征，消除杀软与 EDR 启发式误报；
  - **运行中 `.exe` 免停机热替换与用户目录 Junction 兼容**：`WriteResourceToFile` 升级为 `MoveFileExW` + `.old` 原子重命名热替换（`prism-win-cua.exe` 驻留期间亦可无缝原地覆盖），并放行 `%USERPROFILE%` 父级合法的整盘迁移 NTFS Junction（继续严格拦截 `.gemini/` 内部重解析点）。
- **自定义对话/代码字体、三档性能模式、代码块吸顶滚动补偿与四项轻量光学微交互（[prism-suite.js](extensions/prism-suite.js) / [prism-suite-fx.js](extensions/prism-suite-fx.js) / [prism-suite-fx.css](extensions/prism-suite-fx.css) / [custom.js](vendor/anti-claude/user/custom.js)）**：
  - **三档性能模式与忽略系统减少动画**：`✦ 棱镜` 新增 `省电（0fps 静态节能） / 均衡 / 满血` 三档切换及 `忽略系统「减少动画」` 开关（解决 Windows 关闭系统窗口动画连带冻结思考球与伙伴动效的痛点），新增对话正文与代码等宽字体独立预设芯片与自定义字体族输入（带 CSS 注入安全校验）；
  - **长代码块顶栏 Sticky 吸顶、收起防跳飞补偿与思考块 `#L` 源码跳转**：未折叠长代码块顶栏随滚动自动吸顶便于随时复制或收起，收起超长代码块时自动按高度差同步修正视口 `scrollTop` 保持阅读视线不跳飞；思考块中译文内的源码路径与 `#L` 行号升级为一键定位胶囊；
  - **右侧常驻轮次圆点目录轨与会话大纲免点击全量轮次直出**：接入宿主原生会话导航上下文（无 Fiber 环境自动无感回退纯 DOM 模式），解决长会话分页折叠历史步骤导致未点击前仅显示单颗圆点的问题——开屏即渲染完整历史轮次圆点并自动居中跟随当前激活胶囊，悬停按需预取历史提问摘要，点击或 `Alt+↑/↓` 原生支持跨未挂载分页直跳；
  - **四项 `0fps` 轻量光学微交互（100% MIT 原创实现）**：① `<kbd>` 微立体陶瓷/石墨键帽与变更/Artifact 卡片顶边 `1px` 光学切面高光；② 分屏拖拽条 `[data-sash-handle="true"]` `1px` 隐形极细分割线（悬停微光、保留完整 `8px` 热区）；③ 输入框三态 `0fps` 边缘语义余晖（待确认琥珀金 / 异常珊瑚红 / 完工翡翠绿，聚焦输入框即刻消退）；④ 输入框底栏紧凑 `5h · 7d` 双池额度微胶囊（增量脏检查零输入法闪烁，点击展开限额详情，`Shift+点击` 直达账号接力）。
- **全仓多模型联合安全与并发审计加固 + 上游 `agy-powertools v2.16.11` 同步（[content-agent.js](extensions/chrome-cua-bridge/content-agent.js) / [PrismWinCua.cs](native/win-cua/PrismWinCua.cs) / [cua-broker.mjs](vendor/anti-claude/core/cua-broker.mjs) / [model-hub.mjs](plugin/server/model-hub.mjs) / [account-vault.mjs](plugin/server/account-vault.mjs)）**：
  - **CUA 密码/验证码全链路硬拦截**：修复浏览器扩展桥 `isSensitiveField` 恒假表达式漏洞（完整拦截验证码/安全码/OTP/跨源支付 iframe），并在桌面与网页 `press_key` 中对敏感焦点仅放行纯导航键（阻断 `Ctrl+V` / `Shift+Insert` 剪贴板粘贴绕过），补齐桌面 L4 无坐标物理回退焦点密码框预检、`\t` 分段复检、`Region` 句柄释放及 `30s` `wait_for` 支持；
  - **Broker 作用域并发隔离与异步非阻塞发现**：`consentInFlightByScope` 按目标与权限级别独立分桶防并发提权串用，`idempotencyCache` 绑定 SHA-256 载荷指纹（复用冲突返 `409` 且不缓存未授权拒绝），子进程 `stdin` 挂载防 `EPIPE` 保护，`wsl.exe` 探测改为异步单飞 + `60s` 缓存；
  - **模型中枢流式 Idle Timeout、偏好四端对齐与凭据兼容**：`model-hub.mjs` 升级为 `60s` 流式分块空闲超时 + `10min` 总上限（根治深度思考模型长链推理误超时）并适配 `o1/o3/o4/gpt-5` `max_completion_tokens`；四端统一 50 键 `ui-prefs.json` 白名单与跨 OS/WSL 切号锁；工作台表单聚焦期间延迟后台冲刷防打断输入；吸收 `agy-powertools v2.16.11` 的 macOS `go-keyring-base64:` 凭据解包、`refreshHash` 指纹提取与原生活跃槽格式保护，同步 7 源 `upstream.json` 基线并新增第 25 组 `mini-dom` 运行时沙箱与杀软卫生门禁测试。

## 0.8.4 - 2026-11-27

- **修复 `ThinkingOrb` 粒子思考球与 `✦ 棱镜` 视觉增强分区初始化中断问题（[prism-suite-fx.js](extensions/prism-suite-fx.js) / [prism-suite.js](extensions/prism-suite.js)）**：
  - 补齐 `initFxModule` 内部独立的 `fxCleanups` 清理队列（并在 `dispose()` 时按序回收），修复此前两处裸调 `onCleanup(...)` 抛出 `ReferenceError` 导致 `ThinkingOrb` 挂载与 `✦ 棱镜` 特效设置分区未完成注册的问题，同时在 [prism-suite.test.mjs](test/prism-suite.test.mjs) 新增第 24 组初始化防回退单测。
- **左侧边栏虚拟列表 GPU 合成器原生丝滑滚动与覆盖滚动条图层优化（[custom.js](vendor/anti-claude/user/custom.js) / [custom.css](vendor/anti-claude/user/custom.css)）**：
  - **解除全局 `passive: false` 滚轮阻塞**：新增 `syncSidebarWheelListener()`，默认原生侧边栏模式下不挂载 `document` 级 `passive: false` 滚轮监听，将滚轮 `100%` 交由 Chromium GPU 合成器线程执行硬件平滑惯性滚动；
  - **切断虚拟行回收触发主对话区重排**：全局 `MutationObserver` 识别 `[data-testid="conversation-list-sidebar"]` 内部 TanStack Virtual 行换入换出后不再触发全页 `syncStepStream()`（彻底消除长对话场景下滚动侧栏连带重扫主视图代码块与面板尺寸的卡顿），且 `uxI18nObserver` 直接跳过纯会话虚拟行遍历；
  - **图层隔离与滑块跟帧加速**：为侧边栏列表启用 `contain: layout style` 并收敛 `:has()` 选择器作用域，同时为宿主覆盖滚动条滑块 `[data-testid="overlay-scrollbar-thumb"]` 开启 `will-change: transform` 独立 GPU 位移层。
- **CI 发布与巡检工作流升级原生 Node 24 官方组件（[release.yml](.github/workflows/release.yml) / [upstream-watch.yml](.github/workflows/upstream-watch.yml)）**：
  - 将 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 升级至 `@v7`，`actions/github-script` 升级至 `@v9`，`softprops/action-gh-release` 升级至 `@v3`，消除 GitHub Actions Runner Node 20 弃用黄标提示。

## 0.8.3 - 2026-11-27

- **模型会诊中枢与网关配置防 SSRF / 防泄密纵深加固（[prism-profile.mjs](plugin/server/prism-profile.mjs) / [model-hub.mjs](plugin/server/model-hub.mjs)）**：
  - **云元数据（IMDS）与保留地址精准拦截（100% 保留 Tailscale 与局域网兼容）**：`validateHttpEndpointUrl` 新增 `isBlockedMetadataOrSpecialHost`（含 8-word IPv6 数值展开解析），拦截 AWS/GCP/Azure（`169.254.169.254`、`fd00:ec2::254`）、阿里云 ECS（`100.100.100.200`）、未指定/链路本地/组播地址及其 IPv4-mapped IPv6（`[::ffff:a9fe:a9fe]`）/ NAT64 变形，同时完整保留 `localhost`、`[::1]`、RFC1918 局域网、Tailscale CGNAT（`100.64.0.0/10`）与 MagicDNS（`*.ts.net`）直连能力；
  - **出站请求禁重定向与响应流字节硬上限**：`askModel` 出站 `POST` 与 `/models` 探测统一强制 `redirect: 'error'`（杜绝恶意网关 `302` 跨源重定向套取密钥或绕过主机校验），并通过 `readBoundedResponseText` 限制错误体（`16KB`）、`/models` 枚举（`2MB`）与 JSON 响应体（`4MB`）内存峰值。
- **应用内一键自更新与构建发布供应链加固（[upstream-radar.mjs](plugin/server/upstream-radar.mjs) / [release.yml](.github/workflows/release.yml) / [upstream-watch.yml](.github/workflows/upstream-watch.yml)）**：
  - **跨平台源码包 `.sha256` 强校验与纯 Node 二进制归档审计**：GitHub Release 新增附带 SHA-256 校验文件的官方源码归档 `Anti-Claude-Prism-Suite-Source.tar.gz(.sha256)`；WSL / macOS / Linux 自更新优先核验 `.sha256`（对缺失配套校验文件的异常资产报错阻断防降级），并在调用系统 `tar` 前通过纯 Node 二进制 USTAR/PAX/LongLink 头解析拦截软硬链接、设备节点与路径穿越（同时兼容 GNU `tar` 与 macOS `bsdtar`）；
  - **CI 门禁与巡检 Issue 脱敏**：`release.yml` 增加 `plugin-cua` 语法门禁与 Tag / `package.json` / `CHANGELOG.md` 版本号一致性强校验；`upstream-watch.yml` 自动对非代码块 `@username` 与危险 HTML 标签转义并限制单 Issue 长度（`60k` 字符安全截断并自动闭合代码块）。
- **日常高频性能细节打磨与上游雷达同步（[account-vault.mjs](plugin/server/account-vault.mjs) / [daemon.mjs](vendor/anti-claude/core/daemon.mjs) / [app.html](plugin/ui/app.html) / [prism-suite.js](extensions/prism-suite.js)）**：
  - **凭据库 Provider 密钥 `60s` 纯内存缓存**：`getProviderSecret` 新增仅驻进程内存的 `60s` TTL 缓存（与更新/删除/`invalidateCache()` 实时联动），省去连续多轮模型会诊时重复拉起 PowerShell 读取系统凭据库的开销；
  - **防后台锁仓库、隐藏态 `0%` GPU 停帧与原位编辑保撤销栈**：守护进程 `execGitAsync` 统一附加 `-c core.fsmonitor=false` 避免在用户仓库拉起常驻 `fsmonitor--daemon` 锁住目录；窗口隐藏时为 `<html>` 标记 `data-ag-prism-hidden="1"` 硬停像素伙伴舞台全部 CSS 动画；文件工作台编辑同一路径时原位复用 `<textarea>` 节点，完整保留光标选区与浏览器原生 `Ctrl+Z` 撤销历史；
  - **上游基线同步**：核验并同步双端 [upstream.json](upstream.json) 中 `CursorTouch/Windows-MCP` 基线至最新 `ccbe664`（7 个监控源全部对齐最新状态）。

## 0.8.2 - 2026-11-27

- **修复开启 `prism-cua` 插件时报 `MCP error` 的占位符与命名空间问题（[plugin-cua/mcp_config.json](plugin-cua/mcp_config.json)）**：
  - 将 `plugin-cua/mcp_config.json` 中的入口路径占位符从宿主不解析的 `${__dirname}` 修正为标准 `${PLUGIN_ROOT}/server/index.mjs`（附 `--data_dir=${PLUGIN_DATA}`），消除启用插件时的 `MODULE_NOT_FOUND` 启动报错；
  - 将服务键名修正为 `"control"`，使宿主自动拼接生成的 MCP 服务标识精准对齐为 `prism-cua_control`（消除此前重复前缀 `prism-cua_prism-cua_control`），并在 [prism-suite.test.mjs](test/prism-suite.test.mjs) 新增配置门禁断言防止回退。

## 0.8.1 - 2026-11-27

- **新增独立「Prism AI 可视化虚拟指针」与 Windows 四级无感防抢鼠路由（实测后台操作 `0px` 物理鼠标位移、零焦点抢占）**：
  - **Windows 桌面透明穿透虚拟指针悬浮层（[PrismWinCua.cs](native/win-cua/PrismWinCua.cs) / [cua-broker.mjs](vendor/anti-claude/core/cua-broker.mjs)）**：新增 `64x64` 逐像素 Alpha 分层悬浮窗 `VirtualCursorForm`（`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST` + `UpdateLayeredWindow`），在 AI 执行点击、输入、滚动时平滑滑动带 `AI` 徽标与扩散波纹的专属虚拟指针，内核级 `100%` 鼠标穿透不挡用户点击，动作结束自动淡出隐藏并停止计时器（空闲 `0%` CPU，随 Job Object 自动回收绝无残影）；
  - **浏览器页面内零常驻虚拟指针（[content-agent.js](extensions/chrome-cua-bridge/content-agent.js)）**：在 `ARMED` 标签页按需挂载 Shadow DOM 隔离的 GPU `transform` 虚拟指针与点击波纹，新增网页视口 `(x, y)` 坐标点击与右键支持，动作完成后 `1s` 自动移除节点（空闲 `0` 定时器、`0` DOM 残留）；
  - **Windows 四级「不抢真鼠标优先」自适应动作路由**：移除原 `RunAct` 入口无条件抢焦点的 `SetForegroundWindow` 与全局 `SendInput`，改为按目标能力逐级无感派发：
    1. **L1（已授权浏览器网页）**：DOM / 原生原型链 Setter + 页面虚拟指针，`100%` 不动系统鼠标与焦点；
    2. **L2（桌面 `@wN` 与标准 UIA 控件）**：MTA 线程直调 `InvokePattern` / `TogglePattern` / `SelectionItemPattern` / `ExpandCollapsePattern` / `ValuePattern` / `ScrollPattern`（支持后台被最大化窗口遮挡的目标软件），实现 **`0px` 物理光标位移、`0` 前台焦点抢占**；
    3. **L3（桌面传统 Win32 子句柄）**：通过 `RealChildWindowFromPoint` + `PostMessageW` / `SendMessageTimeoutW(WM_SETTEXT)` 定向后台投递鼠标与文本消息，同样不动真实鼠标；
    4. **L4（Electron / 自绘无 UIA 窗口回退）**：默认 `courteous`（智能无感礼让）模式通过 `GetLastInputInfo` 检测用户物理键鼠静止 `>= 350ms`（用户正在拖拽鼠标时主动避让），在 `<12ms` 内完成瞬移点击并立即调用 `SetCursorPos` 将真实光标精准归位原坐标；若切换为 `strict_virtual`（严格后台零触鼠）模式，则对需借用物理输入的窗口直接返回 `PHYSICAL_CURSOR_REQUIRED` 安全拦截。
- **工作台「`电脑操控`」页签新增 AI 工具休眠开关与虚拟鼠标双档策略切换（[app.html](plugin/ui/app.html) / [index.mjs](plugin/server/index.mjs) / [plugin-cua](plugin-cua/server/index.mjs)）**：
  - 新增 **`🤖 AI 电脑操控工具按需开关`**（`cua_bridge_set_tools_enabled` + 宿主 `prism-cua` 实时开启态探测），支持在工作台内一键休眠/唤醒 `cua_*` 工具（休眠时 `tools/list` 零工具占用），并优化默认关闭（Default-Off）说明指引；
  - 新增 **`✨ 智能无感礼让`** 与 **`🔒 严格后台零触鼠`** 一键切换按钮（`cua_bridge_set_mouse_mode` 同步 Broker 与 `0600` 权限 `cua-settings.json`），在 `cua_act` 中透传 `mouseMode`、`delivery` 与 `physicalCursorMoved` 审计字段；
  - 修复工作台「账号接力 → 上游生态动态」展开后无法独立折叠收起的问题，并加固切号冷启动后登录欢迎框自动确认逻辑（兼容汉化「由您掌控」与异步延迟挂载）。
- **修复顶栏「工作台」按钮误触左栏与左侧边栏条目随鼠标上下漂移问题（[prism-suite.js](extensions/prism-suite.js)）**：
  - **根因修复**：① `isFullPageWorkbenchActive` 改用可见视口/输入框检测（过滤后台缓存的 `0x0` 会话节点），确保全局工作台已打开时再次点击能准确返回对话；② 顶栏 `工作台` 优先展开右侧 `切换侧边面板 / 切换辅助看板` 定位右侧分屏标签或 `界面扩展` 选择器，避免误跳左侧边栏；③ 彻底移除左栏及会话行上的无配对 `pointerdown`（改用纯 `safeClickElement` 并在下拉菜单触发器补齐成对 `pointerup`），根治宿主 `@dnd-kit` `PointerSensor` 被挂起导致左侧 `Prism 工作台` 条目粘在鼠标上跨列表漂移的问题。
- **响应社区 Issue #1：新增纯前端轻量安装模式（`--no-plugin`）、顶栏工作台开关与细粒度上下文暴露控制**：
  - [install.mjs](install.mjs) 新增 `--no-plugin`（一键部署内置 Anti-Claude 内核 + 前端棱镜扩展，跳过 `prism-files` 与 `prism-cua`）、`--no-file-card-rule`（不注入 `rules/AGENTS.md`）与 `--no-skills`；
  - `✦ 棱镜` 控制面板新增 **`顶栏「工作台」快捷入口`** 显隐开关（`showWorkbenchBtn`，跨端口与重启持久保存）；
  - 工作台「账号接力 → 上下文精简与插件组件开关」新增按组启用/隐藏模型可见 MCP 工具（文件卡片组 / 槽位记忆组 / 模型会诊组）、`rules/AGENTS.md` 与内置 Skills 的可视化开关，兼顾完整工作台界面与零冗余上下文。
- **上游雷达巡检吸收、防限流双优化与基线同步（`agy-powertools v2.16.10` / `Windows-MCP` / `obsidian-prism`）**：
  - [upstream-radar.mjs](plugin/server/upstream-radar.mjs) 新增两项无感防限流优化：① 未配置 `GITHUB_TOKEN` 时自动尝试单次 `gh auth token` 并仅缓存在进程内存中复用（不落盘、不打日志，失败静默回退匿名，避免共享出口 IP 匿名 `60/h` 耗尽）；② 对 `api.github.com` 请求增加 `ETag / If-None-Match` 本地 `0600` 缓存，利用 HTTP `304 Not Modified` 免扣 GitHub API 配额；
  - Clean-Room 增加中文输入法 `compositionstart/compositionend` 组词期间后台 DOM 静默避让防闪烁，以及 macOS Keychain `>3KB` 大体积凭据 `-X <hex>` 防截断写入，并同步双端 `upstream.json` 基线。

## 0.8.0 - 2026-11-27

- **窗口最小化恢复「零白屏」三层性能优化（实机热更新生效）**：
  - **首帧让路与唤醒防踩踏**：重构 [prism-suite.js](extensions/prism-suite.js)、[prism-suite-fx.js](extensions/prism-suite-fx.js)、[runtime.js](vendor/anti-claude/core/runtime.js) 与 [custom.js](vendor/anti-claude/user/custom.js) 的 `visibilitychange / focus / resize` 恢复链路，采用 **双 `requestAnimationFrame` + `140ms` 合并防抖单次唤醒**，消除窗口恢复第 0 帧的重复同步重排阻塞；
  - **常驻微件去离屏模糊与守护进程隐藏页免打扰**：移除常驻轮次圆点目录与状态胶囊的 `backdrop-filter` 离屏高斯模糊重建开销，并在 [daemon.mjs](vendor/anti-claude/core/daemon.mjs) 增加 `__agSyncHostVisibility` 最小化期间静默跳过非必要 `Runtime.evaluate` 心跳；
  - **可选快捷方式防后台降频开关**：在顶栏 `✦ 棱镜 → 工作流与效率` 新增可选开关 **`极速窗口恢复（防最小化白屏）`**，按需为 Windows 快捷方式追加或还原 `--disable-renderer-backgrounding`。
- **新增默认关闭（Default-Off）零上下文损耗的 Windows 原生电脑操控与浏览器受控桥体系（`prism-cua` + `prism-win-cua.exe` + `chrome-cua-bridge`）**：
  - **双插件按需解耦架构（日常编码 `0` 额外工具 Token）**：主插件 `prism-files` 严格保持 8 个高频模型可见工具不变；桌面与网页受控能力独立拆分为同级插件 `plugin-cua/`（部署至 `~/.gemini/config/plugins/prism-cua`，仅暴露 `cua_status` / `cua_observe` / `cua_act` 三个高内聚工具），默认 `"disabled": true` 不占上下文，需要时通过 `customization://prism-cua` 一键热开启；
  - **Windows 原生 CUA 宿主与 `0ms` 打字延迟保护（`native/win-cua/PrismWinCua.cs`）**：基于系统自带 `.NET Framework 4.8`（`/target:winexe` 零黑框 GUI 子系统 + Job Object 防孤儿进程 + 构建期 `.sha256` 强校验），支持 Per-Monitor V2 多屏负坐标 `65536` 逐像素映射、置顶显式授权弹窗（首 `450ms` 防盲敲误触）、屏幕顶边无焦点状态胶囊、MTA 线程受限 UIA 采集，以及**硬跳过 `Antigravity.exe` 自身与跳过 `Chrome_WidgetWin_1` 全树 UIA 遍历**以死守 `0ms` 打字延迟；
  - **Codex 同款单键 `Esc` 动态作用域急刹（平时写代码零抢键）**：仅在 `cua_act` 实际操控键鼠的执行窗口期动态挂载 `RegisterHotKey(VK_ESCAPE)` + 步间 `GetAsyncKeyState` 轮询（动作结束立即释放，不影响日常 `Esc` 使用），按下瞬间 `<10ms` 清空队列、收回本轮授权并自动补发 8 个修饰键抬起信号防按键卡死；支持声明式 `batch_actions`（`1..12` 步、前置/后置断言、载荷指纹绑定的 `Idempotency-Key` 防冲突缓存與增量 Diff）；
  - **Chrome / Edge 136+ MV3 零空闲开销受控浏览器桥（`extensions/chrome-cua-bridge/`）**：采用确定性公钥固定扩展 ID `lbmibnghmlnidfiihkegicaejaacmkca` 与 `/target:winexe` 无黑框 Native Messaging 中继；**严格仅对用户在扩展弹窗中显式点亮 `ARMED` 的同源标签页生效**，跨源跳转或进入受保护页立即自动撤权，`0` 个授权页时自动断连清零开销；命中密码框拒绝读写，命中 Turnstile / reCAPTCHA / hCaptcha 立即切入 `PAUSED_HANDOFF` 移交人工。
- **Prism 工作台升级为七合一响应式看板（新增第 7 页签「`电脑操控`」）**：
  - 在 [plugin/server/index.mjs](plugin/server/index.mjs) 新增 4 个仅前端可见（`visibility: ["app"]`）的管理桥接工具（`cua_bridge_status` / `cua_bridge_revoke` / `cua_bridge_register_nm` / `cua_bridge_open_ext_dir`），支持 `127.0.0.1` → WSL2 宿主机私网网关自动探测，并将 `cua-broker.json` 纳入敏感文件只读隔离名单；
  - 在 [plugin/ui/app.html](plugin/ui/app.html) 新增 `电脑操控` 双栏宽屏仪表盘（支持 `Alt+7` 与 `lastTab` 记忆、可持久隐藏的 `cuaIntro` 架构说明卡）：左栏提供实时授权状态与租约倒计时、一键急刹收回权限、Chrome/Edge 扩展三步引导卡；右栏实时展示当前 `ARMED` 浏览器标签页与可观测桌面窗口列表。
- **双插件与单文件安装器全链路同步升级（[install.mjs](install.mjs) / [uninstall.mjs](uninstall.mjs) / [build-win-exe.ps1](scripts/build-win-exe.ps1) / [PrismSuiteInstaller.cs](installer/win/PrismSuiteInstaller.cs)）**：
  - `node install.mjs` 与 `Anti-Claude-Prism-Suite-Setup.exe` 自动原地保句柄（保留目录 inode）同步部署 `prism-files`、`prism-cua`（含 WSL2 目标环境）及 `~/.gemini/antigravity/prism-suite/chrome-bridge`，卸载时一并干净移除且不影响其他同级插件。

## 0.7.0 - 2026-11-27

- **新增零依赖 SSE 流式「模型会诊中枢（Model Hub）」与双轨快速配置**：
  - 原生支持 `OpenAI Chat`、`OpenAI Responses` 与 `Anthropic Messages` 流式协议、T1–T4 四级能力梯队编排、拖拽收藏排序、单模型/批量 TTFT 测速、1 跳备用模型自动降级、防 SSRF 公网代搜与出站敏感信息脱敏，并提供 `/v1/models` 自动探测勾选导入与零密钥 AI 代配口令（修改已绑凭据库网关域名时强制重验密钥）。
- **新增双模 SQLite FTS5 槽位记忆库与 3 项内置协作 Skill**：
  - 基于 Node `>=22` 内置 `node:sqlite` 实现 WAL + 中英双语 FTS5 交接记忆库與 `catalog:master` 主目录槽位看板（自动识别 WSL `/mnt/*` 9P 挂载盘重定向至原生文件系统防坏库，支持可选远程 Streamable-HTTP Memory 异步桥），并随包内置 `prism-cross-model-council`、`prism-slot-relay`、`prism-upstream-absorb` 三项工程 Skill。
- **全栈界面清晰度、12 款像素伙伴与 Windows 原生体验打磨**：
  - 工作台文件类页签支持 `>=820px` 左右主从双栏分屏、图片 `适应 / 1:1 / 像素锐化` 预览、可持久隐藏并随时由顶栏 `? 说明` 恢复的页面指南，以及顶栏/侧边栏双向点击关闭工作台回原对话；
  - 扩展套件升级 12 款高清像素角色（真实跟随 `running` 子 Agent 入场与挥手退场 + 5 大彩蛋）、渲染层优先的 Windows `Ctrl+/` 快捷键与术语校准、全链路 `windowsHide: true` 无黑框子进程与无首次提交（unborn）Git 仓库兼容。

## 0.6.1 - 2026-11-26

- **无损接管修复 WSL 模式下原生「在文件资源管理器中显示」无法打开本地盘符（`C:/D:/E:/F:`）的问题**：
  - **根因**：Antigravity 客户端在 WSL 连接模式下处理 `Show in File Explorer`（`shell:reveal-in-file-picker`）时，`distroToWindowsPath` 将 `/mnt/e/...` 硬拼为 `\\wsl.localhost\<distro>\mnt\e\...`，而 WSL 9P 服务不重复导出 DrvFS 挂载盘符，导致 `shell.showItemInFolder` 静默失效；
  - **内核侧**（[vendor/anti-claude/core/daemon.mjs](vendor/anti-claude/core/daemon.mjs)）：新增 `resolveHostRevealTarget` 与 `revealInOsFileManager` RPC 通道，支持将 `file:///mnt/<盘符>/...`、`/mnt/<盘符>/...` 及 `\\wsl.localhost\<distro>\mnt\<盘符>\...` 精确还原为原生 Windows 盘符路径（同时兼容纯 Linux `/home/...` 映射至 `\\wsl.localhost\<distro>\...`），严格拦截公网/局域网外部 UNC（防 NTLM 泄露）、NTFS 备用数据流（`:`）与路径穿越，并通过 `windowsVerbatimArguments: true` 执行 `explorer.exe /select,"..."`（完美兼容含空格与逗号路径）；
  - **前端侧**（[extensions/prism-suite-workflow.js](extensions/prism-suite-workflow.js)）：新增零观察器开销的菜单点击捕获器（可在 `✦ 棱镜` 面板开关 `WSL 资源管理器定位修复`），通过 React Fiber 与活跃预览面板定位目标文件 URI，自动接管 WSL 路径下的「在文件资源管理器中显示」并平滑收起原生下拉菜单。
- **插件清单清理**：将 [plugin/plugin.json](plugin/plugin.json) 的 `suggested_prompts` 精简为 3 条，消除 Antigravity `language_server` 周期性截断告警日志。

## 0.6.0 - 2026-11-26

- **一体化内嵌继承 `Anti-Claude v3.1.9` 增强内核（独立完整版，告别二次安装）**：
  - 将 `hongqi7/Anti-Claude`（MIT 协议，最新 `v3.1.9`）完整运行时与本项目定制的 `user/extensions/*.{css,js}` 热加载器、`getUsageSummary` 近 14 天/12 周本地用量统计、`translateText` 分片中译及 WSL↔Windows 会话桥接钩子一体化打包进 `vendor/anti-claude/`（附 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 完整 MIT 归属声明）；
  - 升级跨平台 [install.mjs](install.mjs) / [uninstall.mjs](uninstall.mjs) 与 Windows 一键安装器 [PrismSuiteInstaller.cs](installer/win/PrismSuiteInstaller.cs)：单次安装自动部署 `~/.gemini/antigravity/anti-claude/runtime/`、3-way 合并保护用户本地配置、为 Windows 快捷方式幂等补齐 `--remote-debugging-port=0`，并自动注册拉起后台 CDP 守护进程，**新用户仅装本项目一个安装包即 100% 开箱即用，无需再单独安装其他前置项目**；老用户通过工作台「🚀 一键更新」也会同步升级底层内核。
- **修复分池短板账号误挂「推荐」徽章与窄栏折行**：
  - 前后端双重引入全模型池木桶短板校验（`evaluateQuotaPoolHealth` / `evalAccountPoolHealthClient`）：即使某账号顶层或 `Claude/GPT` 池接近满血，只要 `Gemini`（或任一池）剩余额度 `< 20%` 红灯告警，一律一票否决主号恢复提醒、主号优先加权与 `推荐` 徽章（仅当显式指定单一模型时按单池评估），前端独立兜底计算无需等待后台服务进程重启即刻生效；
  - 收紧窄侧边栏下待切换紧凑卡头部单行弹性布局（标题自动省略截断，按钮精简为 `⚡ 切换` 绝不挤压折行）。
- **Clean-room 择优融合三家上游更新并同步基线**（`Anti-Claude v3.1.9` / `agy-powertools v2.16.3` / `obsidian-prism v1.0.8-beta.3`）：
  - 补全 Antigravity `v2.35.1–2.35.2` 运行中模型菜单生效范围提示（`tooltipNote`）、旁路追问（`/btw`）与 Skills / Customizations / Marketplace 简繁词条（[prism-suite-workflow.js](extensions/prism-suite-workflow.js)）；
  - 新增零冲突的「输入框拖入/粘贴本地文件与文件夹转 `@路径` 引用」兜底助手（原生或 `Anti-Claude v3.1.9` 已消费事件时自动避让不重复插入），并为 `Prism 工作台` 目录/产物/收藏列表行开启原生拖拽直投；
  - 升级 Windows 脱离重启器（[relaunch-client.mjs](plugin/server/relaunch-client.mjs)）：移除嵌套 `-EncodedCommand` 与 `Win32_Process.Create`，改用受限临时自清理 `.ps1` 文件 + `15s` 超时拉起，消除杀软误报拦截。
- **「上游生态动态（Upstream Radar）」全库一键合并复制与精准中文摘要重构**：
  - 将分散在各仓库的复制按钮整合为顶栏统一的 **「📋 一键复制已勾融合指令 (N)」** 与 **「✅ 一键同步全部基线」**，自动按仓库分组生成单条结构化融合指令（附精准中文摘要 + 原文对照 + 未勾选仓库基线归拢），彻底告别重复粘贴与空段落；
  - 修复预发布版本（如 `v1.0.8-beta.3`）漏检、多提交截断吞项、`inspiration-only`（GPL）仓库默认误全勾，以及 `pure-Node`→“纯节点”、`filter`→“滤波器”等生硬机翻，新增原版 Release 官方中文升级要点折叠展示。

## 0.5.9 - 2026-11-26

- **保持概览面板跨侧栏折叠展开**：修复当「概览（Overview）」面板与右侧辅助侧边面板（如 `Prism 工作台`）同时展开时，收起侧边面板导致分屏重排连带关闭概览面板的问题；新增可见面板识别、滑动窗口防环保护与焦点还原，仅在手动点击概览开关或按 `Escape` 关闭时收起。
- **面板展开时圆点目录智能避让左移**：当右侧浮动面板（概览面板、`✦ 棱镜` 设置浮层等）展开覆盖聊天区右缘时，常驻轮次圆点目录（`#ag-ps-outline-rail`）实时检测右缘碰撞并平滑左移至浮动面板左侧留白处，超窄视口下自动渐隐防遮挡文字。
- **「账号接力」去重、焦点分层与紧凑重构**：
  - 修复分模型池（`Gemini` / `Claude / GPT`）过重置时间后未同步回血推算为 `100%` 的数据矛盾，并为健康主号滞回推荐加入低额度保护；
  - 去除顶栏重复邮箱胶囊、默认角色别名重复（如 `[备用] 备用账号` 自动展示易读邮箱前缀）以及顶层汇总条与分池百分比的上下重复；
  - 新增「正在使用 Hero 焦点大卡 + 待切换紧凑决策卡」分层布局，支持一键切换 `排序:在线置顶 / 排序:主号置顶`，并将指纹、最近使用、原位改备注名、预演、手动录入额度、主备角色切换与删备份收纳进右上角 `⋯` 管理抽屉。

## 0.5.8 - 2026-11-26

- **修复多会话切换后小精灵消失 & 障碍探测误隐藏**：
  - [extensions/prism-suite.js](extensions/prism-suite.js)、[extensions/prism-suite-fx.js](extensions/prism-suite-fx.js) 与 [extensions/prism-suite-workflow.js](extensions/prism-suite-workflow.js) 新增可见多会话输入框与视口定位器（`getActiveInputBox` / `getActiveViewportEl`），解决 Antigravity 切换对话缓存后台 DOM 节点时 `getElementById` 命中首个隐藏旧输入框导致小精灵、流光边框、思考球与轮次圆点停留在旧对话的问题（切换侧边栏对话 65ms 瞬时跟随）；
  - 收紧 `scanDockObstacles` 探测带（不再向下探入输入框内部，并排除对话滚动区内的常规文本链接与消息操作按钮），消除对话末尾链接/按钮触发 `data-yield="1"` 误将小精灵透明隐藏的问题。
- **小精灵「全局大小」实时跨会话同步与防漏存**：
  - 将 `--ag-ps-sprite-w` / `--ag-ps-sprite-h` 提升至 `:root` 全局 CSS 变量，滑块拖动过程中自动 140ms 防抖持久化至本地存储与跨端口 Cookie，所有历史/新建对话与多账号全局共用同一尺寸，无需重复调节。
- **修复开启「用户消息气泡着色」后气泡底部多出一截空白的问题**：
  - 根因：[extensions/prism-suite-workflow.js](extensions/prism-suite-workflow.js) 的轮次悬停操作条 `.ag-ps-turn-actions`（高 22px + `margin-top: 4px`）原以文档流插在 `[data-testid="user-message-bubble"]` 内部且默认 `opacity: 0`，撑高了气泡底部 26px；
  - 修复：将 `.ag-ps-turn-actions` 移至气泡外层包裹容器并改为右上角脱离文档流的毛玻璃悬浮胶囊（带无缝悬停桥接热区），同时清零着色气泡内尾段多余下边距并排除原生内联编辑态卡片，气泡高度 100% 紧贴文字。

## 0.5.7 - 2026-11-26

- **彻底修复切换账号 / 重启客户端后 `✦ 棱镜` 扩展设置丢失的问题（跨端口三层持久化 + 自动找回旧设置）**：
  - 根因：Antigravity 每次重启都会绑定新的本地随机端口，而浏览器 `localStorage` 按 `协议 + 主机 + 端口` 严格隔离，导致重启换端口后 `localStorage['ag_prism_suite_prefs_v1']` 为空并退回默认开关；
  - [extensions/prism-suite.js](extensions/prism-suite.js) 新增全量 38 项配置白名单归一化器、`_ts` 时间戳比对与跨端口共享的宿主级 Cookie 镜像（`ag_prism_prefs_v1`，RFC 6265 同主机跨端口互通、首屏 `0ms` 同步无闪烁），并支持 `window.__agPrismDiskPrefs` / `hydrateDiskPrefs` 磁盘种子回填；同时加固 `registerDefaults` 类型自愈与像素伙伴/思考中译子开关的事件广播；
  - [plugin/server/account-manager.mjs](plugin/server/account-manager.mjs) 新增只读 `readLocalPrismPrefsFromLevelDb` 与 `syncPrismPrefsSeed`：从本机 `Local Storage/leveldb` 自动找回历史端口已保存的棱镜设置落盘至 `ui-prefs.json`，并在切号准备重启前自动生成无敏感信息的 `prism-suite-00-prefs.js` 种子，卸载时自动清理零残留。
- **修复全仓关联体验疏漏（6 项）**：
  - **跨端口「返回上次会话」与重启落首页回跳条**：[extensions/prism-suite-fx.js](extensions/prism-suite-fx.js) 将最近会话路径同步至跨端口短效 Cookie；切号重启后落在空白欢迎首页 `/` 时顶部提供一键「返回上次会话 ↩」（不触发自动跳转倒计时，点新建对话不误弹）；
  - **`✦ 棱镜` 顶部账号胶囊实时回退与防旧号残留**：未打开工作台时自动回退展示当前在线账号邮箱、在线绿点与套餐胶囊，切号后自动屏蔽未刷新的旧账号摘要；
  - **修复 `Antigravity Starter Quota` 套餐名被截断为 `Quot`**：存储上限统一放宽至 48 字符，界面精简展示为 `Starter`（悬停查看完整名称）；
  - **5h / 7d 低额度免打扰按账号邮箱隔离**：A 账号点击关闭提醒不再屏蔽切过去后的 B 账号预警；
  - **客户端重启器保留显式调试端口号**：[plugin/server/relaunch-client.mjs](plugin/server/relaunch-client.mjs) 原样保留命令行中的 `--remote-debugging-port=<N>`（未指定具体端口时默认 `0`）。

## 0.5.6 - 2026-11-26

- **修复切号并完成自动重启后，顶部仍残留「待重启生效」提示横幅**：
  - [plugin/server/account-manager.mjs](plugin/server/account-manager.mjs) 在切号落盘 `pendingSwitch` 时记录 `switchedAtMs`、`originPid` 与 `originBootMs`；重启后新拉起的 `prism-files` 进程在 `getStatus()` 时自动识别自身启动时间晚于切换时间（或 PID 已更换且当前活跃凭据已为目标账号），立即自动清除 `pendingSwitch` 并持久化，不再误提示重启。
- **切到新号刚重启后自动补刷首次额度（免手动点刷新）**：
  - [plugin/ui/app.html](plugin/ui/app.html) 在「账号接力」页检测到当前在线号刚重启尚未落盘额度时，自动按阶梯间隔（`4s → 6s → 10s → 15s → 20s`）静默补刷，一旦客户端完成首次额度拉取立即自动展示并停止轮询。

## 0.5.5 - 2026-11-26

- **新增「✨ Prism Suite 官方一键更新（推荐）」**：
  - 在 [plugin/server/upstream-radar.mjs](plugin/server/upstream-radar.mjs) 与 [plugin/server/index.mjs](plugin/server/index.mjs) 新增 app-only 工具 `prism_self_update_check` / `prism_self_update_apply`：仅放行官方仓库 GitHub Release 资产、强制校验 `.sha256` 摘要防篡改，校验通过后静默执行 `--silent-install` 原地升级 Windows 扩展 + Windows/WSL 插件（保留目录 inode），完成后提供一键重启 Antigravity 生效按钮；macOS / 原生 Linux 自动走官方 Release 源码包原地升级。
- **上游更新雷达全面中文化（人话摘要 + 进阶分区）**：
  - 将上游仓库与每条 commit 自动转换为通俗中文说明与中文标签（`有重要更新 / 有常规更新 / 已同步`、`新功能 / 修复 / 安全`，支持实时轻量中译 + 离线本地领域词典兜底，原始 commit SHA 与英文原文退至悬停提示）；
  - 在 [plugin/ui/app.html](plugin/ui/app.html) 重构为「🚀 版本更新与上游动态」双层布局：顶部主推「Prism Suite 一键更新」，下方将「上游生态动态」清晰标注为面向进阶用户的可选参考区。

## 0.5.4 - 2026-11-26

- **修复「账号接力」页签展开手风琴后被压扁裁切且无滚动条的问题**：
  - [plugin/ui/app.html](plugin/ui/app.html) 中 `.relay-scroll` 子元素新增 `flex-shrink: 0` 与底部留白，防止 Flex 列布局在展开「槽位交接记忆 / 上游更新雷达」时强行压缩卡片高度导致内容裁切；同时为 `.list-scroll` 补充清晰的 6px 细滚动条样式。

## 0.5.3 - 2026-11-26

- **常驻轮次圆点目录避让滚动条与分屏拖拽条**：
  - [extensions/prism-suite-fx.js](extensions/prism-suite-fx.js) 中 `positionOutlineRail()` 按视口实际滚动条宽度 + `16px` 安全留白向内偏移，并给对话视口挂载轻量 `ResizeObserver`，拖动分屏边框或开关右侧栏时实时平滑避让，不再与滚动条滑块重叠干扰。
- **输入框流光边框新增「常驻流光 / 仅生成时」模式切换**：
  - 默认切为「常驻流光」：开启开关后窗口聚焦即柔和流动，AI 生成时自动加速提亮，失焦/最小化自动 0fps 休眠；也可随时在子面板切回「仅生成时」纯生成态模式。
- **备用账号卡片视觉层级区分**：
  - [plugin/ui/app.html](plugin/ui/app.html) 为备用/离线账号卡片新增独立 `.is-account-slot` 卡片表面底色、清晰边框、微阴影与中性左侧标识条，与纯白背景及下方工具/手风琴区形成清晰分层，同时保留当前在线主账号的蓝色高亮主视觉。

## 0.5.2 - 2026-11-26

- **修复热重载后 `✦ 棱镜` 面板丢失「视觉特效与排版」「效率交互与多语言」设置**：
  - 根因：Anti-Claude 按文件名 `localeCompare` 顺序加载扩展（`prism-suite-fx.js → prism-suite-workflow.js → prism-suite.js`）；热重载整包注入时，前两个子模块先挂到旧总线，随后 `prism-suite.js` 重建总线并执行旧清理钩子，把刚注册的分组一并注销且无重挂机制；
  - 修复：[extensions/prism-suite-fx.js](extensions/prism-suite-fx.js)、[extensions/prism-suite-workflow.js](extensions/prism-suite-workflow.js) 与 [extensions/prism-suite.js](extensions/prism-suite.js) 升级为持久化模块注册表 `window.__agPrismModules`（带实例令牌防重复挂载），任何加载/热重载顺序下都会自动把全部 3 个模块完整挂载到最新总线。
- **服务端直读本机只读 LevelDB 实时额度缓存，彻底解决卡片停在「正在同步」**：
  - 在 [plugin/server/account-manager.mjs](plugin/server/account-manager.mjs) 新增零依赖、纯只读 `readLocalAntigravityQuotaCache`（按 `mtime+size` 缓存加速），在 `accounts_status` 读取时直接解析 Antigravity `Local Storage/leveldb` 中最新的 `ag_claude_ux_quota_cache_v1` 快照，严格按 `accountKey` 绑定邮箱匹配防串号，彻底绕过 MCP App 沙箱 `iframe` 隔离；
  - 在 [plugin/ui/app.html](plugin/ui/app.html) 升级账号卡片额度直观展示：红/琥珀/绿双进度条（5h / 7d 剩余与精确重置倒计时）+ 独立 `Gemini` / `Claude/GPT` 分家族额度胶囊与同步时间标签。
- **账号切换聚焦严格绑定对应按钮（不再劫持常规工作台打开）**：
  - 仅点击「切号 / 账号接力」关联按钮（`✦ 棱镜 → ⚡ 切号`、低额度提醒 `⚡ 去切号`、设置页返回条 `⚡ 账号接力`）时切换并聚焦「账号接力」且不污染 `lastTab`；
  - 普通「工作台」入口与侧边栏打开时清理残留跳转意图，并只记忆/恢复常规工作台页签（`目录浏览 / 最近产物 / 收藏夹 / 历史检索`）。

## 0.5.1 - 2026-11-26

- **全自动精准实时额度同步（免手动填写 · 防串号 · 分模型家族）**：
  - [extensions/prism-suite.js](extensions/prism-suite.js) 优先直读 Anti-Claude 结构化额度缓存 `localStorage['ag_claude_ux_quota_cache_v1']`（零延迟、无需打开右侧概览面板，DOM 正则降级兜底），直接提取精确的 `5h` / `weekly` 剩余百分比、秒级 `resetTime.seconds`、订阅等级 `tierName`、Gemini/Claude 分家族池与 `accountKey` 绑定邮箱，同时一并增强输入框额度光环（`quotaRing`）与 5h/7d 低额度交接提醒；
  - [plugin/server/account-manager.mjs](plugin/server/account-manager.mjs) 与 [plugin/server/index.mjs](plugin/server/index.mjs) 新增 `expectedEmail` 防串号核验（切号未重启期间若旧缓存邮箱与当前活跃账号不一致则自动安全跳过，绝不串写）及 `tierName` / `families` 持久化；
  - [plugin/ui/app.html](plugin/ui/app.html) 自动在卡片展示订阅等级徽章、精确 5h/7d 进度条与分家族剩余额度，并清晰区分在线自动同步与离线回血推算说明。

## 0.5.0 - 2026-11-26

- **切号后自动安全重启 Antigravity + Windows 凭据库防 `exit 1` 加固与 `0ms` 多级缓存**：
  - 新增 `plugin/server/relaunch-client.mjs` 与 app-only 工具 `accounts_relaunch_client`：脱离 WSL/MCP 进程树经 Explorer COM → WMI → `Start-Process` 三级投递优雅重启 Antigravity（快照原始 PID 绝不误杀新实例，自动探测并保留 `--remote-debugging-port=0` 扩展挂载参数），支持切后自动重启持久化开关与一键立即重启按钮；
  - 根治 WSL2 下 `Windows 凭据管理器调用失败: exit 1`：安装器（`install.mjs` & `installer/win/PrismSuiteInstaller.cs`）升级为**原地增量覆盖保留根目录 inode**，守护进程启动即 `chdir(homedir)`，`account-vault.mjs` 新增 `resolveSafeExecCwd`、`resolveWslInteropEnv`、PowerShell 单次批量事务与 `120s/60s` 脱敏元数据缓存（实机热读取由 `~2200ms` 降至 `0ms`，`accounts.json` 外部 `mtime` 变更自动失效缓存），并支持对未捕获新号切走前自动建槽防丢。
- **实时额度自动桥接 + `✦ 棱镜` 账号胶囊一键直达**：
  - 主扩展 `prism-suite.js` 与工作台 `app.html` 建立脱敏 `postMessage` 双向通信桥（绝不传凭据）：主界面监测到的 5h / 7d 剩余百分比与重置倒计时自动增量同步写入当前账号卡片（配合 `prism_quota_sync`）；
  - `✦ 棱镜` 控制面板顶部新增「当前账号 & 实时额度胶囊 + `⚡ 切号` 一键直达账号接力」入口，顶栏 `工作台` 按钮优先拉起右侧分屏并动态展示当前账号与额度摘要；工作台自动记忆上次停留页签（`lastTab`）。
- **工作台 UI 精修、60fps 微动效、纯键盘流与代码行号区间引用**：
  - `app.html` / `inline.html` 建立宿主 CSS 变量桥接、顶部 `2px` 流光进度条（SWR 静默刷新不闪白）、`requestAnimationFrame` 60fps 倒计时进度条、长列表 `content-visibility: auto`、手风琴记忆与窄分屏顶栏单行不折行；
  - 「目录浏览」升级可点击路径面包屑 + `Ctrl/Cmd+L` 编辑双态、未截断目录 `0ms` 本地过滤（含中文 IME 保护）及 **`↑ / ↓ / Enter / Backspace` 纯键盘导航**；代码预览新增 **一键复制全文** 与 **点击行号 / `Shift+点击` 选中行区间生成 `@path#L10-L25` 精确引用给 AI**。
- **Windows 图形安装器同步加固（`installer/win/PrismSuiteInstaller.cs`）**：
  - 升级版本号与原地增量更新保 inode 策略，新增桌面/开始菜单快捷方式 `--remote-debugging-port=0` 只读自检提示。

- **彻底修复小精灵遮挡输入区上方交互控件缺漏（`extensions/prism-suite`）**：
  - 将障碍扫描范围从仅 3 层父容器扩大至主对话交互区域，覆盖输入区上方动态弹出的 `ask_question` 选择卡（麦克风 / 跳过 / 提交 ↵）、工具审批条与折叠控件；
  - 新增障碍签名动态追踪与可用宽度评估，按钮密集时自动带着 `+N` 徽章平滑向下缩回藏起（`data-yield="1"`）并在卡片消失后探头回归；鼠标进入交互带即时触发闪避（`💨`）与收起浮窗，`.ag-ps-more-badge` 动态跟随安全空位绝不挡按钮。
- **主备多账号半自动倒计时安全接力（默认关闭，物理隔离会话与凭据）**：
  - 新增 `plugin/server/account-vault.mjs`：通过 OS 原生凭据管理器隔离命名空间（Windows `prism-suite:account:<id>`、WSL2 `prism-suite:wsl:<distro>:account:<id>`、macOS Keychain、Linux Secret Service）存取 OAuth 凭据，PowerShell 经 `-EncodedCommand` + `stdin` JSON 零插值调用 `advapi32.dll`，内存凭据用后 `.fill(0)` 清零，强校验 `id_token_email` 防串号并在异常时原子回滚；**100% 不触碰 Antigravity 本地 SQLite、`/brain/` 与 workspace**；
  - 新增 `plugin/server/account-manager.mjs` 与 `scripts/prism-accounts.mjs`：提供 `switch.lock` 跨进程并发锁、主号唯一性、5h 跨家族提示、模型兼容守卫、主号恢复滞回提醒、`--dry-run` 预演及切前 4 要素交接快照；
  - **Prism 工作台新增第 5 标签页「账号接力」**（所有账号工具严格标记 `visibility: ['app']` 对模型不可见）：支持显式安全确认开启、一键捕获主/备账号、5 秒可暂停/取消倒计时切号横幅、与切后重开回跳指引。
- **零依赖槽位交接记忆 + 外部 `memory-mcp` 联动桥（`handoff-memory.mjs`）**：
  - 随 `prism-files` MCP Server 向模型暴露 3 个轻量工具 `prism_memory_store` / `prism_memory_list` / `prism_memory_search`，按 `handoff:<project>:<slot>` **严格时间倒序**精确拉取最新进度，写入前自动脱敏私钥 / API Key / GitHub Token / JWT；
  - 工作台支持一键复制标准化外部 `memory_store` 同步指令与切后 `接力` 续写提示，随仓附通用开源规则模板 `templates/multi-account-handoff.rule.md`。
- **择优筛选版上游更新雷达（Upstream Radar）**：
  - 升级 `upstream.json`（v2，同步 `plugin/upstream.json`）纳入 `hongqi7/Anti-Claude`、`WhiteBr1ck/agy-powertools`、`RMvdesi/obsidian-prism`、`anglee0323/agy-switch` 四个上游并各自明确边界；
  - 升级 `plugin/server/upstream-radar.mjs` 与 `scripts/check-upstream.mjs`（Compare API + 三分类：`兼容性必看 / 实用新功能候选 / 建议跳过` + `--markdown` / `--sync-baseline` + GPL Clean-Room 警示），坚持**只吸收有益部分、供用户决定是否融合、绝不照搬照抄**；
  - 工作台按需点击检查 + 新增 `.github/workflows/upstream-watch.yml` 每周定时巡检并在发现 `HIGH`/`MEDIUM` 变更时幂等更新唯一候选清单 Issue。

## 0.4.1 - 2026-11-25

- **全项目四模型联合审计加固（P0/P1/P2 全清）**：
  - **Prism 文件工作台 2.0 安全边界升级**：`open_prism_files` 与同步文件接口全链路拦截未授权 UNC/SMB 与设备前缀；`searchTranscripts` 改为**先脱敏再匹配截取**（彻底杜绝私钥/Token 中段泄露）；`resolveHomeAndBrain` 对 `brainDir` 递归 `realpathSync` 归一化（防软链/联接点绕过只读保护）；`isSensitivePath` 拦截 Windows NTFS ADS（`::$DATA`）与尾随点/空格绕过；WSL UNC `.localhost`/`wsl$` 自动转换与 `.cmd` 显式参数安全启动；`inline.html`「打开方式 ▾」弹出时动态同步 iframe 高度防裁切；`app.html` Markdown 引用块递归上限 16 层。
  - **核心总线 & 交互体验加固**：补齐 `unregisterPanelSection` / `unregisterOutlineAction`、去除 `setPref` 冗余二次渲染、大纲点击防外层误关且重构为无嵌套合规 HTML、思考译文盒弱引用精确清理、统一高优 `Escape` 浮层栈、`keepOverviewOpen` 限定仅 `/c/<id>` 会话路由生效、禁止原位编辑自动点击通用 `Undo/Revert`、修复 `cleanCopy` 对异步 `navigator.clipboard.writeText` 支持、修复安装器 `C:\` 盘符根路径与 `--plugin-dir` 嵌套问题。
- **小精灵主动避障 + 指针闪避 + 防遮挡质感浮窗**：
  - 新增输入框周边控件障碍检测，自动将小精灵停靠并漫游在安全区域；当鼠标指针靠近踩中胶囊 `^` / `×` 等按钮的小精灵时，触发短距灵动快跑让位（`💨` 微表情 + 穿透点击不挡操作）；
  - 移除原生 `title` 提示，全面切换为正上方预留间隙、绝不遮挡指针的圆角毛玻璃状态浮窗（带运行中/待命状态色点）。
- **手动切号自动回跳上次会话 + 5h/7d 额度交接提醒**：
  - 默认零风险记住进入 `/settings` 前最后一个 `/c/<id>` 会话路由，停留在设置页时浮现「返回上次会话 ↩ / 留在设置」一键回跳条（可选开启安全倒计时自动回跳，绝不盲关未知弹窗、100% 保留全部会话记录）；
  - 新增 5h ≤ 10%（建议先切另一模型家族）与 7d ≤ 5%（提示存交接并切备用号，一键复制交接指令）轻量化去重提醒条。

## 0.4.0 - 2026-11-25

- **模块化事件总线与零卡顿性能加固（`window.__agPrismBus v4`）**：
  - 核心扩展 `prism-suite.js` 发布加载顺序无关的版本化总线（支持 `AbortController` 热重载无残留清理），将新功能清晰拆分为 `prism-suite-fx.{js,css}` 与 `prism-suite-workflow.{js,css}`；
  - 新增 `<html>` 属性与 CSS 变量脏检查、已完成历史轮次 `WeakMap` 缓存、CJK 输入法组合态（`compositionstart/end`）与触屏拖动期防抖礼让；
  - 新增主题自适应自定义悬浮提示（`data-ag-ps-tip`）与控制面板底部按需 **GitHub 新版本检查胶囊**。
- **视觉特效、排版与侧栏细节（`prism-suite-fx`）**：
  - **工作时输入框流光边框（Border Beam，默认关闭）**：基于单共享 `rAF` 调度器的 Canvas 2D 圆角矩形周长彗星流光，支持 `theme / gemini / aurora / prism / neon / quota` 6 套配色与「试用 3s」即时预览，空闲/隐藏/失焦严格 `0fps` 停帧；
  - **输入框额度光环（默认关闭）**：0fps 静态 SVG 外框顺时针展示 `5h / 周 / 较低项` 剩余额度，工作时与流光边框自动平滑互斥切换；
  - **ThinkingOrb 3D 粒子任务进度球（默认关闭）**：预分配 128 颗 Fibonacci 球面粒子随思考/工具/输出/完成态形变，悬停带视差倾角，收敛 1.2s 自动停帧，支持与像素萌宠共存或替换；
  - **实用排版与交互**：用户消息气泡着色（5 色系 + `10%–100%` 滑条 + 自动对比度）、紧凑排版开关、后台完成窗口标题 `(N)` 未读数提醒、项目默认展示会话数、切换会话保持右侧概览展开、多轮对话侧边常驻圆点目录。
- **效率工作流、多语言与会话分支（`prism-suite-workflow` + `scripts/fork-session.mjs`）**：
  - **对话图片右键三连**：右键会话图片弹出主题菜单，支持「引用到输入框」「复制图片（PNG）」「保存图片」；
  - **回复复制过滤折叠摘要**：点击回复复制按钮自动滤除已折叠思考/工具摘要，完整保留代码块与原生打勾动效；
  - **SSH 粘贴自动解析**：在 SSH Host 弹窗粘贴 `ssh -p 端口 用户@主机` 自动提取并丢弃附带密码；
  - **2.34–2.35 & Swarm 增量多语言补全**：支持 `关 / 简 / 繁 / 英` 切换与 `WeakMap` 无损还原，零全局 `MutationObserver`；
  - **原位消息编辑补位 & 历史轮次分支**：轮次悬停提供快捷「编辑」（优先联动 Anti-Claude 原生 Undo 编辑，不可用时启动乐观锁原位编辑器）与「分支」（同步接入大纲抽屉，附零依赖回环 CDP 脚本 `scripts/fork-session.mjs`）。
- **Prism 文件工作台 2.0（`prism-files` MCP App）**：
  - **修复 Windows 含空格/逗号/盘符根目录资源管理器定位**：原生 `win32` 改用 `/select,"<path>"` + `windowsVerbatimArguments: true`，WSL 采用双参数 `['/select,', winPath]` 规避引号转义；
  - **可选私网 LAN NAS/SMB 路径支持（默认关闭）**：开启前强制校验全部 DNS 解析 IP 与字面量均属 RFC1918 / Tailscale CGNAT / ULA / 环回 / `wsl$`，严格拦截公网主机防 NTLM 凭据泄漏；
  - **「打开方式 ▾」动态探测本机编辑器与终端**：自动识别 VS Code、Cursor、Windsurf、Antigravity、Zed、JetBrains、Windows Terminal、Git Bash 等并支持 `#L:C` 行列号直达，Windows `.cmd/.bat` 经元字符拦截后显式经 `cmd.exe /d /s /c` 安全启动（规避 Node 22 `EINVAL`）；
  - **跨历史会话脱敏全文检索**：工作台新增第 4 标签页 **`历史检索`**，在符号链接根牢笼与时间/体积预算内检索本地 `transcript.jsonl`（支持 `全部 / 正文 / 代码与命令` 筛选），自动脱敏 API Key / Token / 私钥片段。

## 0.3.0 - 2026-11-25

- **全新融合 · Prism 文件工作台（原生 Antigravity MCP App 插件，零外部依赖）**：
  - **侧边栏 & 全局三合一工作台（`open_prism_files`）**：支持工作区文件树浏览、`Ctrl/Cmd+L` 路径直达、实时检索、隐藏文件切换、代码/Markdown（渲染预览 + 带 SHA-256 乐观锁的安全原位编辑）/图片双栏分屏预览、**划词引用给 AI**（`ui/update-model-context`）、一键在 Antigravity 原生标签页打开（`com.google.antigravity/toggle-aux-pane`）、**`~/.gemini/antigravity/brain` 最近产物速查**与持久化收藏夹；
  - **消息流内联文件卡片（`show_files_inline`）**：产出文件时直接在对话中渲染交互卡片，支持一键原生打开、引用上下文，以及 **全平台双击高亮定位系统文件管理器**（Windows `explorer.exe /select,`、WSL 自动 `wslpath -w` 桥接 Windows 资源管理器、macOS `open -R`、Linux `xdg-open`）；
  - **严格安全与零上下文膨胀**：模型仅见 2 个轻量工具，其余 7 个交互工具均设为 `visibility: ["app"]`；预览与写入均前置拦截 `.env`/密钥/`.codex`/`.claude`/`.ssh` 等凭据路径，且 `brain/` 产物目录强制只读。
- **Windows 一键图形化安装器 `.exe`（零运行库依赖）**：
  - 新增纯 C# WinForms 安装器源码（`installer/win/PrismSuiteInstaller.cs`）与一键打包脚本（`scripts/build-win-exe.ps1`），内置全量扩展与插件资源，双击自动探测 Windows Anti-Claude 目录、Windows 插件目录与 **WSL 真实 `$HOME` 插件目录**，支持「一键安装 / 更新」与「干净卸载」；
  - 新增 GitHub Actions Release 工作流（`.github/workflows/release.yml`），打 Tag 自动构建并发布 `Anti-Claude-Prism-Suite-Setup.exe` 与 SHA-256 校验文件。
- **一体化 CLI 安装/卸载**：`node install.mjs` 与 `node uninstall.mjs` 现默认同步部署/清理 Anti-Claude 扩展与 `prism-files` MCP App 插件（支持 `--extensions-only` / `--plugin-only`）。

## 0.2.4 - 2026-11-25

- **控制面板与大纲视觉精修**：
  - 将「像素小伙伴」子设置归组进柔和浅底内嵌子面板（`.ag-ps-subpanel`），主开关与子设置层次一目了然；
  - 分段选择器升级为克制的「轨道 + 浮起白/暗块」风格，收敛视觉强调色，仅把主题主色留给激活开关、当前配色框与滑块拇指；
  - 去掉弹窗与大纲标题旁的灰色装饰胶囊，改用 `tabular-nums` 排版元数据，并定制 `4px` 细轨滑块与 `160ms` 缓出浮层入场微动效（严格遵守 `prefers-reduced-motion`）。
- **新增 2 套护眼配色 + 双色圆点色卡**：深浅配色扩展为 `2×2` 网格并升级「底色 + 强调色」双色预览圆点，新增浅色 **`松雾青岚`**（雾青纸底 + 苍松翠绿）与深色 **`深海墨蓝`**（午夜海蓝底 + 冰海青蓝），热力图与配额全自动联动。
- **像素伙伴对话气泡 60fps 零开销跟随**：将气泡锚定至说话小精灵外层容器并附底部小尖角与左右防裁切对齐。

## 0.2.3 - 2026-11-25

- **像素伙伴 5 项零开销趣味体验升级**：
  - **伙伴性格档位（`温顺` / `活泼`）**：温顺模式仅慢速踱步与轻跳不翻滚；活泼模式全开前空翻、滚翻冲刺、集体波浪翻与击掌互动；
  - **头顶状态微表情**：零额外 RPC，自动联动当前上下文水位与阶段——深度思考 `💡`、工具执行 `🔧`、高水位/缓存塌陷提醒 `💦`、空闲休眠纯静态 `zZ`；
  - **同伴擦肩击掌**：漫游落地时 O(N) 轻量距离检测（6 秒冷却），擦肩相遇时面对面轻跳击掌并弹出 `🤝 / ⚡`；
  - **摸头 5 连击彩蛋**：2 秒内连点同一小精灵 5 次触发原地三连空翻与专属傲娇台词（零全局 `mousemove` 监听）；
  - **高 TTFT 长等待发呆 + 首字惊醒**：发问超过 8 秒未出首字原地轻晃打盹，首字吐出瞬间全员弹跳惊醒恢复全速巡逻。

## 0.2.2 - 2026-11-25

- **像素伙伴工作态漫游跑跳、杂技动作与 `tok/s` 变速（独立开关，默认开启）**：AI 或蜂群/子 Agent 工作时，小精灵沿输入框顶边全宽透明轨道自主随机小跑、**360° 前空翻跟头**、**翻滚冲刺**、**二段连跳**、**开心摇摆**、高跳与左右张望，运动速度与步频随实时 **`tok/s`** 动态变速（`0.75× ~ 2.05×`）；任务完成归位瞬间全体错峰触发**波浪式集体翻跟头**庆祝，点击任意小精灵也会随机表演彩蛋动作，闲时 5 秒后自动恢复 `0fps` 零定时器休眠。
- **像素伙伴无级大小调节**：控制面板新增 `16px ~ 36px`（步进 `2px`）实时无级滑块与一键复位（默认 `24px`），底部锚点自动贴合输入框顶边不偏移。
- **动态 Agent 数量模式（固定 / 跟随 Agent + 1~3 只保底）**：新增「跟随 Agent」数量模式，直接复用 Anti-Claude 实时下发的蜂群与子 Agent 谱系（零额外 RPC/SQLite 开销），按 `1 主控 + 存活蜂群/子 Agent` 自动增减精灵（上限 8 只 + `+N` 徽章），并支持自定义 **`1~3 只保底数量`** 防止无子 Agent 时空屏；扩充至 6 种原创 `12×11` 像素萌物（橘蟹 / 紫猫 / 蓝史莱姆 / 绿蛙 / 金雏 / 粉兔），支持按单个 Agent 实时 `running` 状态独立跑跳与悬停查看名称。

## 0.2.1 - 2026-11-25

- **思考翻译视觉柔化**：移除译文块的灰底色块、粗蓝左竖线与醒目标题，改用与 Antigravity 原生思考流融为一体的轻灰无框排版；沉浸模式下完全贴合原生视觉，仅在顶部右侧保留极淡的 `查看原文` 按钮。
- **README 实机预览**：补充控制面板、用量统计（14 天柱图 + 名著换算 + 12 周热力图）与输入框三萌像素小伙伴三张 2x 高清实机截图。

## 0.2.0 - 2026-11-25

- **彻底消除输入框打字迟滞（性能优化）**：移除常驻 `document.body` 的全局 `MutationObserver`，水墨淡入改为仅在 AI 生成态监听 `[data-testid="autoscroll-viewport"]`（与输入框完全隔离，打字 0 回调），复用 5 个固定 `Highlight` 对象并限频至 30fps，支持 `prefers-reduced-motion`；后台 `tickAll` 放宽至 2.4s 并加入输入静默礼让（打字后 1.8s 不扫 DOM）与页面隐藏暂停；概览补挂观察器去掉 `subtree: true`。
- **扩展隔离与翻译稳定性（交叉审计 P0 修复）**：
  - 守护进程加载扩展前通过 `node:vm` 预检语法错误并用独立 `try/catch` 隔离，单扩展异常绝不波及 `custom.js`；
  - 翻译 RPC 改为按段落/句边界 ≤ 950 字符短分片顺序合并（支持最长 10,000 字，杜绝 HTTP 414）；
  - 思考翻译不再在流式生成中每 1.4s 重复发请求，折叠后自动清理译文不残留，沉浸模式下每块新增「看原文 / 隐藏原文」一键切换按钮。
- **交互与视觉打磨（交叉审计 P1 修复）**：
  - 浮卡与大纲动态贴合按钮正下方 8px，支持 `Esc` 关闭并归还焦点、`window.resize` 自动重定位；
  - 浅色模式下点选深色配色（或反之）提供即时反馈提示；
  - `Alt+↑/↓` 跳轮改为每次基于当前视口位置重新计算，大纲高亮当前阅读轮次；`/btw` 填入失败自动降级复制剪贴板；
  - 12 周热力图严格按周一~周日对齐自然周，补齐 `partial` 续拉，新增连续活跃天数（Streak）、活跃日均与《四库全书》大额换算标尺。
- **上游双仓伴随更新体系**：新增 `upstream.json` 与 `npm run check-upstream`（`scripts/check-upstream.mjs`），一键追踪 `hongqi7/Anti-Claude` 与 `RMvdesi/obsidian-prism` 上游动态并核查本地底座接口兼容性。

## 0.1.0 - 2026-11-25

- 首次发布 **Anti-Claude Prism Suite**（Clean-room 独立可扩展插件套件）。
- 支持四套深浅主题、会话大纲与 `Alt+↑/↓` 跳轮、用量名著换算与 12 周热力图、五级水墨流式吐字淡入、输入框 0fps 像素小伙伴、思考过程实时中文转译，以及 `install.mjs` / `uninstall.mjs`。

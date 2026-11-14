# TICK STOCK PANEL Pro (天才交易员改造工作台 v1.1.0-enterprise)

面向 A 股量化研究、游资短线复盘、跨市场超前认知套利、多标的事实因子历史大复盘、付鹏全球宏观 FICC 交易框架与机构级多租户模拟实盘的一体化桌面量化终端（严格 **Wind 万得 / 同花顺 iFinD PC 专业版** 分栏架构，零圆角 SaaS 卡片、零霓虹光晕、零 Emoji，A 股与国内期货严格采用**红涨绿跌**规范）。

---

## 一键下载桌面安装包（Windows & macOS）

前往本仓库 **[GitHub Releases](https://github.com/woshiyuyanjia123/tick-stock-panel-pro/releases)** 页面下载对应系统安装包（内含 `SHA256SUMS.txt` 校验文件）：

| 平台 | 架构 | 安装包文件 | 说明 |
| :--- | :--- | :--- | :--- |
| **Windows 10/11** | `x64` | `TSP-Pro-Setup-1.1.0-x64.exe` | 标准 NSIS 安装向导（支持自定义安装目录、桌面与开始菜单快捷方式、系统托盘与完整卸载） |
| **Windows 10/11** | `x64` | `TSP-Pro-Portable-1.1.0-x64.exe` | 免安装绿色单文件便携版，双击即开 |
| **macOS** | Apple Silicon (`arm64`) | `TSP-Pro-1.1.0-arm64.dmg` / `TSP-Pro-Installer-1.1.0-arm64.pkg` | M1/M2/M3/M4 原生原生构建（支持 `.dmg` 拖拽安装与 `.pkg` 标准向导安装） |
| **macOS** | Intel (`x64`) | `TSP-Pro-1.1.0-x64.dmg` / `TSP-Pro-Installer-1.1.0-x64.pkg` | Intel Mac 原生构建（另提供 `.zip` 免镜像压缩包） |

> **macOS 首次打开提示“无法验证开发者/已损坏”处理方法**：由于跨平台开源构建未附带 Apple Developer 付费公证签名，将应用拖入 `/Applications`（或运行 `.pkg` 安装）后，若遇 Gatekeeper 拦截，在终端执行一行授权命令即可正常打开：
> ```bash
> sudo xattr -rd com.apple.quarantine "/Applications/TICK STOCK PANEL Pro.app"
> ```

---

## 核心功能全景 (`v1.1.0-enterprise`)

- **Wind / 同花顺原生桌面终端交互（Electron 跨平台外壳 + 内置 Node 24 SQLite 引擎）**：
  - 安装包内嵌独立 `esbuild` 后端与 Chromium 渲染引擎，开机无需额外安装 Node.js 或配置环境变量；数据自动持久化至系统可写用户目录（`%APPDATA%\TICK STOCK PANEL Pro\data` / `~/Library/Application Support/TICK STOCK PANEL Pro/data`）。
  - 顶部 `F1–F12` + `宏观 | 确定买点/付鹏FICC` + `实盘 | 模拟舱/SaaS` 功能区切换条、左侧 `44px` 竖排快捷栏、底部实时指数与全盘涨跌停状态栏、原生系统托盘 / macOS 菜单栏快切与窗口置顶。
  - **实时 SSE 推送流 & 全局键盘精灵**：顶栏实时显示 `[STREAM 实时流]` 状态、多租户席位切换与模拟实盘净值；非输入焦点下直接键入代码/拼音简称或按 `Ctrl+K` 即时唤醒行情盘口。
  - **F5 个股看盘弹窗**：日 K（标准 MA5/10/20/60、`板`/`炸` 涨停炸板标注、MACD/RSI/KDJ/BOLL）+ 分时联动 + 五档盘口与逐笔成交明细。
- **市场全貌 (`F1`) & 连板梯队 (`F3`) & 板块周期 (`F4/F5/F6`)**：
  - 上证/深证/创业板/科创综指、市场广度、大盘承接分析 V1.1（5m/15m/30m）、涨停/炸板/断板天梯矩阵、6 因子龙头评分、250+ 交易日市场环境周期与月度热力图。
- **PandaAI × 期货PM 跨市策略中枢 (`F10`)**：
  - 严格采用 **`UTC -> 北京时间 09:00 盘前截断`** 对齐准则（零未来函数），接入 Polymarket 活跃宏观事件与国内 28 主力期货/A 股瓶颈龙头，挖掘 `Lag -5d..+5d` 领先滞后互相关谱、冲击条件胜率、Granger 检验、滚动协整隐含公允价及预期差 `Z-Score`，支持 4 种事件驱动回测模式与半 Kelly 仓位。
- **全维超前认知定价 & CPO 五节点贝叶斯传导系统 (`F12`)**：
  - **CPO 五节点贝叶斯传导 DAG 门控引擎**：跟踪美股光模块映射（COHR/LITE/AVGO/FN/NVDA）→ 一阶 CPO 核心锚（VWAP 确认）→ 二阶硬件扩散（液冷/PCB/国产算力/AI 电源）→ 创业板双核与期权 PCR/Skew → `IC0/IM0` 对冲执行；内置 4 重反陷阱门控。
  - **零 API Key 超前认知三雷达**：Kalshi × Polymarket × Manifold 跨所概率三角共识、Hyperliquid 24×7 影子永续与国内外期权 25D Skew / PCR、28 期货近远月 Back/Contango 年化展期收益率。
- **多标的专属事实因子历史大复盘 & 付鹏 24h 宏观 FICC 框架 (`宏观 | 确定买点/付鹏FICC`)**：
  - **18 大核心标的专属事实因子复盘与四维确定性买点引擎**：按贵金属利率、地缘咽喉航运能化、AI 光通信硬件、电网储能、红利长债 5 大产业原型定制专属事实因子，逐笔审计 200+ 历史脉冲样本，实证过滤单因子噪音与四维确定性买点（`事实脉冲 + 滞后 Z<=-1.15 + 微观 VWAP/Back 确认 + 拥挤度/Skew 排雷`）的胜率跃升。
  - **付鹏全球宏观 FICC 坐标与动态杠铃回测**：实时测算铜金比 `CU0/AU0`、油金比 `SC0/AU0`、国内长债锚 `TL0` 与套息拆仓去杠杆雷达，联动六大可交易策略篮子，支持因果 `t-1` 动态杠铃回测与一键批量下发模拟单。
  - **付鹏 24h 全网动态实时抓取与笔记解析**：并发聚合华尔街见闻《付鹏说》/金十/财联社、东方财富、新浪财经/微博、Bilibili、Bing RSS 及 `scripts/ego_fupeng_24h_watcher.mjs` 独立守护进程，落库 SQLite `fupeng_intel_items` 并自动识别 FICC 支柱与多空交易标的映射。
- **模拟实盘与 SaaS 企业中枢 (`实盘 | 模拟舱/SaaS`)**：
  - 基于 Node.js 原生 **`node:sqlite` (`WAL` 模式，15 张表)** 实现多租户隔离、自选股分组、`tsp_live_` OpenAPI Key 鉴权、A 股 `T+1` 与国内期货 `T+0` 保证金模拟交易台、五大回测引擎自动归档、Markdown/CSV 研报导出，以及飞书/钉钉/企业微信/Telegram Webhook 实时告警推送。

---

## 本地源码开发与跨平台打包构建

### 环境要求
- Node.js `>= 22.5`（内置 `node:sqlite`，推荐使用 Node `24.x` 或直接运行 Electron `44.x`）
- npm `>= 10`

### 1. 源码开发模式
```bash
git clone https://github.com/woshiyuyanjia123/tick-stock-panel-pro.git
cd tick-stock-panel-pro
npm install
npm run dev
```
- 前端 Vite 开发服务器：`http://localhost:5173`
- 后端 Express + SQLite 服务：`http://127.0.0.1:3130`

### 2. 以 Electron 桌面客户端模式启动 & 冒烟自检
```bash
npm run electron:smoke   # 构建前后端并在独立临时目录完成 15 表 SQLite + 界面渲染冒烟验证
npm run electron:start   # 以完整桌面应用形态启动
```

### 3. 本地打包 Windows 与 macOS 安装包
- **在 Windows 上构建 Windows 安装包（`.exe` NSIS Setup + 便携版）**：
  ```powershell
  $env:CSC_IDENTITY_AUTO_DISCOVERY="false"
  npm run dist:win
  ```
  产物位于 `release/TSP-Pro-Setup-1.1.0-x64.exe` 与 `release/TSP-Pro-Portable-1.1.0-x64.exe`。

- **在 macOS 上构建 Apple Silicon & Intel 安装包（`.dmg` + `.zip` + `.pkg`）**：
  ```bash
  CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
  pkgbuild --component "release/mac-arm64/TICK STOCK PANEL Pro.app" --install-location "/Applications" release/TSP-Pro-Installer-1.1.0-arm64.pkg
  pkgbuild --component "release/mac/TICK STOCK PANEL Pro.app" --install-location "/Applications" release/TSP-Pro-Installer-1.1.0-x64.pkg
  ```

### 4. GitHub Actions 自动多端发版
推送任意 `v*` 标签（如 `git tag v1.1.0 && git push origin v1.1.0`），[.github/workflows/release-installers.yml](.github/workflows/release-installers.yml) 将在云端并行调度 `windows-latest` 与 `macos-latest` 构建机，自动完成冒烟测试、生成 `SHA256SUMS.txt` 并发布全部 Windows / macOS 安装包至 GitHub Releases。

---

> **免责声明**：本项目仅用于个人与机构量化研究、历史复盘、宏观框架推演与模拟盘策略验证，不构成任何证券、期货或衍生品投资建议。A 股及国内期货行情严格采用**红涨绿跌**显示规范。

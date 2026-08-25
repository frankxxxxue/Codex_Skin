# Codex_Skin

> 目录名保留 `Codex_Skin`（创建时按 Codex 命名），实际目标应用是 **OpenAI ChatGPT 桌面版**（Windows，Electron，MSIX 包名仍为 `OpenAI.Codex`，主程序 `app\ChatGPT.exe`）。

把「照片自然融合背景 + 跟随照片取色」效果装到 ChatGPT 桌面版的本机小工具：照片铺满整个窗口，侧边栏/标题栏/内容区完全透明直接透出照片原色，不再有突兀的白色方块。

实现方式：通过本地回环 Chrome DevTools Protocol（CDP）把一段皮肤脚本注入 ChatGPT 的 renderer，**不修改** ChatGPT 的 `app.asar` / WindowsApps 官方文件，可一键恢复官方外观。

> 取色算法移植自 `dsh-photo-skins` 的 `src/client/accent.ts`；背景融合手法参考社区 [Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) / [codex-theme-inject](https://github.com/codecnmc/codex-theme-inject)（底层铺图 + 半透明渐变遮罩 + CSS 变量覆写，不用 backdrop-filter 压整图）。本目录为独立工程，不依赖、不修改 dsh-photo-skins。

## 前置条件

- Windows 或 macOS + OpenAI ChatGPT 桌面版（已安装，Electron 版本）。
- 一张本地照片（PNG / JPG / WebP / GIF）。
- 仅「bat / 命令行」方式需要 Node.js ≥ 22（使用原生 `fetch` / `WebSocket`，运行时零依赖）；「exe / 可执行文件」方式无需 Node。

## 安装与启动

按「对普通用户最方便」排序：

### 方式一：双击可执行文件（零门槛，推荐给普通用户）

从 Release 下载对应平台的单文件并双击运行：自动带调试端口重启 ChatGPT、注入皮肤、恢复上次照片。无需安装 Node、无需命令行。

- Windows：`CodexSkin.exe`
- macOS：`CodexSkin`

> 首次运行可能被系统拦截（exe 未签名 / macOS 未公证）：Windows 点「更多信息 → 仍要运行」；macOS 右键 → 打开，或到「系统设置 → 隐私与安全性」允许。

### 方式二：双击 bat（仅 Windows，需先装一次 Node）

1. 安装 Node.js ≥ 22：https://nodejs.org/（一次性）。
2. 双击 `启动皮肤.bat`。

### 方式三：命令行（开发者）

见下方「用法」。

> 打包可执行文件的方法：在目标平台上运行 `npm run build:exe`（内部用 esbuild 打成 CJS 再走 Node SEA + postject，macOS 额外做 codesign 重签），产物为 `dist/CodexSkin.exe`（Windows）或 `dist/CodexSkin`（macOS）。SEA 不可跨平台交叉编译：macOS 产物必须在 macOS 上构建。

## 用法

### 应用内面板（推荐）

```powershell
node injector\inject.mjs
```

首次会关闭并带 `--remote-debugging-port` 重启 ChatGPT（打断当前会话，加 `--yes` 跳过确认），注入皮肤运行时。之后 **ChatGPT 右下角出现「皮肤」按钮**，点开面板即可在应用内：

- 选择照片（文件选择器）
- 拉「明暗」滑块（-100 压暗 ~ +100 提亮，0=原图）
- 拉「背景模糊」滑块（0-50 px，模糊照片、不碰 UI）
- 切换填充方式 cover / contain
- 一键恢复官方外观（恢复后「皮肤」按钮保留，可再次换肤）

配置（照片压缩后 + 明暗 + 模糊 + 填充方式）会存到 ChatGPT 的 localStorage，下次启动自动恢复上次皮肤。

### 命令行带初始照片

```powershell
node injector\inject.mjs --image "D:\path\to\photo.jpg"
```

直接带初始照片注入（同样会创建右下角面板）。

> 重要：CDP 注入只在「带调试端口启动的 ChatGPT 进程」里生效，脚本不会写进 ChatGPT 安装目录。

### 重启 / 重新开机后如何恢复

ChatGPT 冷启动后调试端口会丢失、皮肤消失。恢复只需一步：

```powershell
node injector\inject.mjs --yes
```

它会自动：检测端口 → 带 `--remote-debugging-port` 重启 ChatGPT → 重新注入 → **从 localStorage 自动恢复上次保存的照片和明暗/模糊/填充参数**。之后皮肤与面板一直存在，直到再次关闭 ChatGPT（正常使用中不要手动刷新页面）。

常用参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--image <path>` | 无 | 照片路径（可选，注入后立即应用） |
| `--dim <n>` | 55 | 明暗：-100(最暗) ~ +100(最亮)，0=原图 |
| `--blur <n>` | 2 | 背景模糊 px（0-50） |
| `--fit cover\|contain` | cover | 壁纸填充方式 |
| `--port <n>` | 9222 | CDP 调试端口 |
| `--restore` | - | 一键还原官方外观 |
| `--probe` | - | dump ChatGPT DOM 摘要（调试/逆向用） |
| `--yes` | - | 重启 ChatGPT 前不确认 |

## 目录结构

```
Codex_Skin/
  injector/
    inject.mjs           # 入口：发现/启动 ChatGPT、连 CDP、注入、恢复、探测
    cdp.mjs              # 最小 CDP 客户端（Node 原生 WebSocket，零依赖）
  skin/
    accent.js            # 取色算法（移植自 dsh-photo-skins/accent.ts，UMD）
    apply-skin.js        # 注入到页面的皮肤脚本（照片图层/取色 + 面板 UI）
  启动皮肤.bat           # 双击启动（仅 Windows；检测 Node 后运行注入器）
  build-exe.mjs          # 打包脚本（esbuild CJS + Node SEA + postject -> CodexSkin.exe / CodexSkin）
  sea-config.json        # SEA 打包配置（内置 accent.js / apply-skin.js 资源）
  LICENSE                # MIT License
  THIRD_PARTY_NOTICES.md # 第三方来源声明（accent.js 按 BSD-3-Clause 使用）
  package.json           # 元信息（license / engines / scripts），运行时零依赖
  .gitignore
  test-photo.png         # 测试用渐变照片
```

## 原理

1. `inject.mjs` 定位 `ChatGPT.exe`，带 `--remote-debugging-port` 启动，轮询 `http://127.0.0.1:<port>/json` 拿到 renderer target 并连 WebSocket。
2. 注入 `accent.js` + `apply-skin.js`（`Page.addScriptToEvaluateOnNewDocument` 持久），再 `Runtime.evaluate` 立即执行（面板 + 从 localStorage 恢复）。
3. `apply-skin.js` 用 canvas 把照片降到 64px 采样，取主色（`samplePalette`），生成皮肤 CSS：
   - 照片铺在 fixed `z-index:-1` 的独立图层（`[data-codex-photo-layer]`），叠一层 dim 遮罩（负值黑=压暗 / 正值白=提亮），`#root` / `main.bg-surface` 透明，让照片贯穿；
   - 模糊用该图层的 `filter: blur()` 直接作用照片（`backdrop-filter` 在 Electron 外壳上不可靠，故改用 filter），明暗滑块与模糊滑块实时生效；
   - 覆写 ChatGPT 原生不透明表面令牌（`--color-surface`、`--color-token-side-bar-background` 等）为 `transparent`，消除白色方块；
   - 侧边栏 / 内容区 / 标题栏完全透明，照片原色直接透出，主要元素边界（border）也透明，照片从侧边栏到内容区连续覆盖、无发白分隔线；
   - 文字可读性靠主题底色 text-shadow 光晕（轻、不遮照片），输入框半透明、弹窗保持半透明可读；
   - 主色写入 `--cs-accent` / `--color-background-primary-solid` 等，应用到提交按钮 / 聚焦 / 链接。

## 恢复

```powershell
node injector\inject.mjs --restore
```

删除注入的 `<style>` 与页面脚本，还原官方外观（官方文件未被改动）。

## 已知限制

- 依赖 ChatGPT 桌面版的内部 DOM 类名（`.app-shell-left-panel`、`[class*="_MainContentSurface_"]`、`main.bg-surface`、`--color-surface` 等），ChatGPT 升级后若类名变化可能失效；`--probe` 可辅助定位。
- 选择器已按 ChatGPT 26.818 实测校正；升级后建议先跑 `--probe` 确认仍匹配。
- CDP 注入只在带调试端口启动的进程里生效，不写入安装目录；每次冷启动需先跑一次注入器。
- 非官方方式，仅本机使用。
- 首次需重启 ChatGPT 以开启调试端口。
- macOS 下 ChatGPT 默认路径为 `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`；若安装位置不同，用 `--exe` 手动指定。

## 免责声明

- 本工具仅用于个人学习与研究，非 OpenAI 官方产品，与 OpenAI 无关。
- 通过本地 CDP 注入只改变本机 ChatGPT 进程的外观，不修改官方安装文件、不收集或上传任何数据。
- 请自行确认使用行为符合 OpenAI / ChatGPT 的服务条款与适用法律法规；因使用本工具产生的任何后果由使用者自行承担。

## 许可证

- 本项目：MIT License（见 `LICENSE`）。
- 第三方：`skin/accent.js` 取色算法移植自 dsh-photo-skins，按 BSD 3-Clause 使用；详见 `THIRD_PARTY_NOTICES.md`。

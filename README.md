# 月下手记 · Moonlit Journal

一个以月夜、深蓝玻璃与冷银月光为视觉基调的个人博客，使用 **Astro + Markdown / MDX + GitHub Pages** 构建。

日常更新以文件为主：写文章、记短笺、追加歌曲都不需要修改播放器或页面代码。网站在构建时收集内容，生成可以直接部署的静态页面，现有功能无需数据库或第三方服务。

- 目标仓库：[fhaworld/bokex](https://github.com/fhaworld/bokex)
- 默认部署地址：[月下手记](https://fhaworld.github.io/bokex/)
- 本地默认地址：[http://localhost:4321/bokex/](http://localhost:4321/bokex/)

## 目录

- [项目功能](#项目功能)
- [日常维护速查](#日常维护速查)
- [本地运行](#本地运行)
- [追加与修改文章](#追加与修改文章)
- [追加月下短笺](#追加月下短笺)
- [追加歌曲与设置背景音乐](#追加歌曲与设置背景音乐)
- [替换图片与修改站点信息](#替换图片与修改站点信息)
- [构建与发布到 GitHub Pages](#构建与发布到-github-pages)
- [项目目录](#项目目录)
- [常见问题](#常见问题)

## 项目功能

| 模块 | 功能 |
| --- | --- |
| 月夜界面 | 全站月夜背景、玻璃面板、柔和月光按钮、鼠标高光与细微倾斜，首页有云雾、微粒和背景视差 |
| 动效控制 | 导航栏可以开关动效；适配手机和系统减少动态效果偏好 |
| 首页手记 | 「精选 / 最近」切换，各显示最多 3 篇文章 |
| 手记列表 | 搜索标题、描述、正文及标签；多标签筛选、日期范围筛选；按发布日期或标题正序 / 倒序排列 |
| 文章阅读 | Markdown / MDX、代码高亮与复制、阅读进度、二三级标题目录、上一篇 / 下一篇、同标签延伸阅读 |
| 月下短笺 | 用独立 Markdown 文件记录短想法，首页显示最新 2 张，并提供完整列表 |
| 月下电台 | 自动扫描本地音乐目录，播放列表按钮展开可滚动选歌浮层，支持播放 / 暂停、切歌、进度和音量调节 |
| 全站音乐 | 背景音乐开关、文章页迷你播放器，通过站内链接切页时连续播放 |
| 月下时计 | 自定义钟面、三根月光指针、设备本地时间；下方显示本站运行天、时、分、秒 |
| 内容分发 | 年份归档、RSS 和站点地图 |

本站运行时间从 **北京时间 2025-12-15 13:31（UTC+8）** 起算。

## 日常维护速查

以下路径都相对于项目根目录，即包含 `package.json` 的文件夹。

| 我想做什么 | 放在哪里 / 修改哪里 | 如何更新 |
| --- | --- | --- |
| 写一篇文章 | `src/content/blog/新文件.md` | 填写文章信息和正文，保存后查看手记页 |
| 修改已有文章 | 对应的 `.md` / `.mdx` 文件 | 修改正文，需要时填写 `updatedDate` |
| 放进首页精选 | 文章开头的 `featured` | 设置为 `true` |
| 记一张短笺 | `src/content/notes/新文件.md` | 填写标题、日期和简短正文 |
| 追加歌曲 | `public/music/` | 放入音频文件，刷新本地页面 |
| 指定背景音乐 | `public/music/background.mp3` | 放入或替换该文件，刷新本地页面 |
| 添加文章图片 | `src/assets/posts/` | 在文章中用相对路径引用 |
| 替换月夜背景 | `src/assets/moonlit-sky.png` | 用同名图片替换后查看预览 |
| 替换时钟底图 | `public/images/moon-clock-face.png` | 用同名图片替换后刷新页面 |
| 修改站点名称和简介 | `src/consts.ts` | 修改 `SITE_TITLE`、`SITE_DESCRIPTION` |

**本地看到修改后，仍需提交并推送，等待 GitHub Actions 构建完成，正式网站才会更新。**

## 本地运行

### 1. 准备环境

- 安装 Node.js，推荐使用 **24**，与当前 GitHub Actions 一致；项目要求最低版本为 `22.23.4`。
- 安装 Git，使用喜欢的编辑器，例如 VS Code。

在终端检查环境：

```sh
node --version
npm --version
git --version
```

### 2. 获取项目并安装依赖

首次获取项目时执行：

```sh
git clone https://github.com/fhaworld/bokex.git
cd bokex
npm ci
```

如果已经有本地项目，直接在现有项目根目录操作即可，不必再次克隆。依赖已安装且没有变化时，也不需要每次重新安装。

### 3. 启动后台预览

```sh
npm run dev -- --background
```

打开 [http://localhost:4321/bokex/](http://localhost:4321/bokex/)。如果端口被占用，以终端实际输出的地址为准，并保留 `/bokex/` 路径。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev -- --background` | 后台启动开发服务器 |
| `npm run astro -- dev status` | 查看后台服务器状态与地址 |
| `npm run astro -- dev logs` | 查看开发日志 |
| `npm run astro -- dev stop` | 停止后台服务器 |
| `npm run build` | 生成正式网站到 `dist/` |
| `npm run preview` | 在本地预览已生成的 `dist/`，地址以终端输出为准 |

后台模式与管理命令可参考 [Astro CLI 命令说明](https://docs.astro.build/en/reference/cli-reference/)。

保存文章和页面代码后通常会自动更新。追加或替换音乐、钟面图片后，手动刷新一次页面；修改 `astro.config.mjs` 后，必要时停止并重新启动开发服务器。

## 追加与修改文章

### 1. 新建 Markdown 文件

在 `src/content/blog/` 中新建文件，例如 `my-first-post.md`，复制以下内容：

````markdown
---
title: '我的第一篇手记'
description: '用一句话介绍这篇文章。'
pubDate: '2026-11-04'
tags: ['随笔', '生活']
featured: false
---

这里开始写正文。

## 今天想记录的事

可以使用 **加粗**、*斜体*、[链接](https://docs.astro.build/) 和列表。

- 一个发现
- 一段经历
- 一个还没有想明白的问题

### 一个小例子

```js
console.log('你好，月下手记');
```

> 给值得记住的片刻，留一点空间。
````

开头两行 `---` 之间的部分称为 frontmatter，用来描述文章。保存后，在本地的「手记」页查看；这个例子的文章链接为 `/bokex/blog/my-first-post/`。

文件名推荐使用小写英文字母、数字和短横线。标题可以使用中文。文件名会影响文章链接，已经分享出去的文章尽量保持文件名稳定。

### 2. 文章字段说明

| 字段 | 是否必填 | 示例 / 说明 |
| --- | --- | --- |
| `title` | 是 | `'我的第一篇手记'`，文章标题 |
| `description` | 是 | 一句话摘要，用于文章列表和页面描述 |
| `pubDate` | 是 | `'2026-11-04'`，发布日期，也是时间排序、日期筛选和归档的依据 |
| `updatedDate` | 否 | `'2026-11-06'`，显示更新日期，不改变按发布日期排序的依据 |
| `tags` | 否 | `['技术', 'Astro']`，不填写时为空数组 |
| `featured` | 否 | `true` 加入首页精选；默认 `false`，布尔值不要加引号 |
| `heroImage` | 否 | `'../../assets/posts/moonwalk.webp'`，文章顶部封面图片 |

日期建议统一写成带引号的 `YYYY-MM-DD`。标签也需要保持 YAML 数组格式。

### 3. 给文章加图片

先创建 `src/assets/posts/` 文件夹，把实际图片放进去，例如 `moonwalk.webp`。

如果文章文件直接位于 `src/content/blog/`，正文图片这样引用：

```markdown
![月夜下的风景](../../assets/posts/moonwalk.webp)
```

封面图片则添加到 frontmatter：

```yaml
heroImage: '../../assets/posts/moonwalk.webp'
```

路径相对于文章文件。文章放在更深的子目录时，需要相应调整 `../` 的层数。保存前确认图片已放入对应位置，文件名、大小写和扩展名一致。

也可以把直接公开访问的静态图片放进 `public/images/`，正文引用实际站点路径，例如：

```markdown
![示意图](/bokex/images/example.png)
```

这里的 `/bokex/` 与部署配置有关；更换仓库路径后要同步修改这类写死的链接。文章封面仍推荐使用上面的 `src/assets/` 相对路径方式。

### 4. 精选、筛选与延伸阅读

- 首页精选：设置 `featured: true`，按发布日期从新到旧取最多 3 篇；没有精选时，默认显示「最近」。
- 标签：直接写在文章信息中，会自动加入手记页筛选器，不需要另外维护标签列表。多选标签时匹配任意一个标签，再与关键词和日期范围组合筛选。
- 目录：文章中的 `##` 和 `###` 标题会自动生成阅读目录。
- 上一篇 / 下一篇：分别是发布日期较早、较新的相邻文章。
- 相关文章：按共同标签数量优先，再按发布日期排序，最多推荐 2 篇；排除当前文章及前后相邻文章，没有匹配时不显示。

当前没有草稿开关或定时发布功能：放进文章目录且通过校验的内容都会被收录。尚未准备公开的草稿请先放在内容集合目录之外。

普通写作使用 `.md` 即可；需要嵌入组件时可使用 `.mdx`，参考项目中的 `using-mdx.mdx`。

## 追加月下短笺

短笺适合几句话的随想，完整文章仍放在手记目录。

在 `src/content/notes/` 新建 `a-small-thought.md`：

```markdown
---
title: '今晚的小发现'
pubDate: '2026-11-04'
---

这里写一小段文字，也可以使用 **加粗**、链接和列表。
```

- `title` 和 `pubDate` 必填，正文使用 Markdown。
- 首页侧栏按日期显示最新 2 张，点击「翻阅全部短笺」进入完整列表。
- `first-note.md` 是示例，可以替换其内容或删除；去掉 `example: true` 就不会显示「示例短笺」标识。

## 追加歌曲与设置背景音乐

### 1. 把音频放进音乐目录

```text
public/music/
├── background.mp3
├── 01 月下散步.mp3
├── 02 夜间来信.m4a
└── 钢琴/
    └── 雨后的街道.ogg
```

追加歌曲后，刷新本地页面，再点击播放器中的「播放列表」按钮，就能看到新曲目。**不需要手写播放列表，也不需要修改播放器代码。**

- 子文件夹也会自动扫描。
- 支持 MP3、M4A、OGG、WAV、FLAC、AAC、OPUS、WEBM；具体解码能力取决于浏览器，推荐优先使用 MP3。
- 歌曲名取自文件路径，去掉扩展名；例如 `钢琴/雨后的街道.ogg` 会显示为 `钢琴/雨后的街道`。
- 支持中文、空格和特殊符号；文件名前加 `01`、`02` 等编号可以控制排序。
- 列表默认收起，支持滚动选歌；选择歌曲后播放并收起，点击外部、关闭按钮或按 Esc 也能收起。
- 删歌或改名时，修改对应音频文件后刷新即可。

### 2. 设置背景音乐

把要用作背景音乐的文件命名为 **`background.mp3`**，放在 `public/music/` 根目录。注意拼写是 `background`，不是 `backgroud`。

也支持 `background.ogg` 等其他已支持的扩展名。同名的多种格式同时存在时，依次优先使用 MP3、M4A、OGG、WAV、FLAC、AAC、OPUS、WEBM；没有指定背景曲时使用排序后的第一首歌曲。

右下角「背景音乐」开关控制这首曲目的循环播放。背景曲同时也会出现在普通播放列表中；播放器与背景音乐共用一个音频输出。

### 3. 自动播放与跨页播放

- 首次访问通常需要点击播放按钮或背景音乐开关。
- 网站会记住音量和背景音乐偏好；偏好开启时会尝试自动播放，如果被浏览器拦截，按页面提示再点击一次。
- 通过本站链接进入手记、文章、归档、关于或短笺页时，音乐会继续，进度和音量会保留。
- 整页刷新、新开标签页、关闭页面或离开本站会重新加载播放器，不属于连续播放范围。

音乐文件会随静态网站公开发布，请使用允许公开分享的音频。

## 替换图片与修改站点信息

| 修改内容 | 文件 | 操作 |
| --- | --- | --- |
| 站点名称、描述 | `src/consts.ts` | 修改 `SITE_TITLE`、`SITE_DESCRIPTION` |
| 首页文字与侧栏介绍 | `src/pages/index.astro` | 修改对应文案 |
| 关于页 | `src/pages/about.astro` | 修改个人介绍 |
| 页脚作者与文案 | `src/components/Footer.astro` | 修改作者名和页脚文字 |
| 导航与英文副标题 | `src/components/Header.astro` | 修改导航项目和 `MOONLIT JOURNAL` |
| 全站月夜背景 | `src/assets/moonlit-sky.png` | 用同名图片替换；推荐横向图片，保持月亮与主要文字区域的留白 |
| 时钟表盘底图 | `public/images/moon-clock-face.png` | 用同名正方形图片替换；透明背景，只画盘面与装饰，指针、数字和刻度由代码叠加 |
| 站点运行起点 | `src/components/MoonClock.astro` | 修改 `data-start`，并同步修改旁边的 `title` 说明 |
| 全局颜色、间距与排版 | `src/styles/global.css` | 修改公共样式；播放器、时钟等组件也包含自己的局部样式 |
| 浏览器标签图标 | `public/favicon.svg`、`public/favicon.ico` | 替换图标文件 |

运行起点当前为：

```html
data-start="2025-12-15T13:31:00+08:00"
```

`+08:00` 明确表示北京时间。运行时长按固定起点计算，不会因为访客设备所在时区不同而改变。上方时钟显示的则是访客设备本地时间。

当前钟面已经针对现有图片调整了圆心和刻度内圈，更换构图不同的图片时，可能需要在 `MoonClock.astro` 中微调对齐。

图片生成参考：

- [月夜背景提示词](docs/night-background-prompt.md)
- [时钟表盘提示词与尺寸说明](docs/moon-clock-prompt.md)

## 构建与发布到 GitHub Pages

### 1. 先在本地审查

确认文章、音乐和界面效果后运行：

```sh
npm run build
```

成功后会在 `dist/` 生成网站。需要查看正式构建效果时，再执行 `npm run preview`，使用终端给出的地址。

**内容和配置应修改源文件。不要只修改 `dist/`，下一次构建会重新生成它。**

### 2. 检查目标仓库

本项目的目标是 `https://github.com/fhaworld/bokex.git`。如果本地同时配置过 `boke` 和 `bokex`，先核对远程地址：

```sh
git remote -v
```

下面的发布示例使用名为 `bokex` 的远程。若还没有该远程，添加一次即可：

```sh
git remote add bokex https://github.com/fhaworld/bokex.git
```

已经存在时不用重复添加。按快速开始重新克隆的项目，`origin` 默认就是克隆目标；确认地址正确后，也可以把下面的 `bokex` 换成 `origin`。

### 3. 提交与推送

下面以日常更新文章、短笺、歌曲和图片为例：

```sh
git status --short
git add src/content/blog/ src/content/notes/ src/assets/ public/music/ public/images/
git diff --cached
git commit -m "content: 更新手记、短笺和音乐"
git push bokex main
```

`git add` 用于选出本次要提交的文件。修改组件、样式、README 或配置时，也要加入对应文件，再用 `git diff --cached` 确认暂存内容。推送前确认当前分支和本次修改都符合预期。

### 4. 等待自动部署

仓库已经包含 `.github/workflows/deploy.yml`：推送到 `main` 会自动构建并部署，也可以在 GitHub 的 Actions 页面手动运行。

首次配置仓库时，在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。当前工作流使用 Node.js 24，构建和上传由 Astro Action 完成，再发布到 GitHub Pages。

推送后到仓库的 **Actions** 页面查看 `Deploy Astro to GitHub Pages`。成功后访问 [默认部署地址](https://fhaworld.github.io/bokex/)；如果失败，先查看失败步骤的日志。

### 5. 更换仓库或部署路径

当前 `astro.config.mjs` 配置是：

```js
site: 'https://fhaworld.github.io',
base: '/bokex/',
```

`site` 对应正式站点域名，`base` 对应仓库子路径。换成其他项目仓库时要同步修改；部署到域名根目录时，将 `base` 改为 `/`。文章中手写的绝对图片和链接路径也要检查。

部署流程参考 [Astro 的 GitHub Pages 官方指南](https://docs.astro.build/en/guides/deploy/github/)。

## 项目目录

```text
.
├── .github/workflows/deploy.yml   # GitHub Pages 自动构建与部署
├── docs/                          # 写作说明与图片生成提示词
├── public/
│   ├── images/                    # 时钟底图与直接公开访问的图片
│   ├── music/                     # 自动扫描的音乐目录，可包含子文件夹
│   └── favicon.svg                # 站点图标
├── scripts/music-dev.ts           # 本地音乐文件与范围请求支持
├── src/
│   ├── assets/                    # 可由 Astro 处理的图片与字体
│   ├── components/                # 导航、手记卡片、播放器、时钟等
│   ├── content/
│   │   ├── blog/                  # 文章：Markdown / MDX
│   │   └── notes/                 # 短笺：Markdown
│   ├── layouts/                   # 全站布局与文章布局
│   ├── lib/music.ts               # 音乐目录扫描与排序
│   ├── pages/                     # 首页、手记、归档、关于、短笺及 RSS
│   ├── scripts/                   # 音乐、时钟、玻璃高光与背景动效
│   ├── styles/global.css          # 公共样式
│   ├── consts.ts                  # 站点名称与描述
│   └── content.config.ts          # 文章、短笺的字段校验规则
├── astro.config.mjs               # 域名、基础路径与集成配置
├── package.json                   # 依赖与运行命令
└── package-lock.json              # 锁定依赖版本
```

## 常见问题

### 新文章为什么没有出现？

确认文件位于 `src/content/blog/`，扩展名为 `.md` 或 `.mdx`，并填写了 `title`、`description`、`pubDate`。再检查手记页有没有保留关键词、标签或日期筛选，以及文章是否只是没有进入首页最多 3 篇的展示范围。

如果构建报错，优先检查 frontmatter 的 `---`、引号、冒号、标签数组和图片路径。正式网站还需要完成推送与部署。

### 新歌曲为什么没有出现？

确认放在 `public/music/`，使用受支持的音频格式，然后整页刷新。本地和正式网站的曲库都在页面生成时扫描；只往 `dist/music/` 放文件不会更新播放列表。正式网站需要提交音频并重新部署。

### 背景音乐为什么不能自动播放？

浏览器可能限制有声音的自动播放，先点击播放按钮或右下角背景音乐开关。也要检查文件名是否正确，且音频文件本身能够被浏览器解码；只更改扩展名不会转换音频格式。

### 页面或图片为什么 404？

本项目使用 `/bokex/` 子路径，本地和正式地址都需要包含它。再检查 `site`、`base`、图片大小写，以及是否已完成部署。相对路径要以引用它的 Markdown 文件为起点计算。

### 网站更新时间为什么和预期不同？

文章排序使用 `pubDate`，更新日期使用 `updatedDate`；文件保存时间和 Git 提交时间不会自动改写它们。站点运行时长则使用时钟组件中单独配置的固定起点。

### 可以直接在 GitHub 上写文章或上传歌曲吗？

可以在仓库对应目录新建 Markdown 或上传音频，按相同规则填写或命名。提交到 `main` 后会触发部署。需要先审查的改动，可以先保存在其他分支，审查通过后再合入 `main`。

## 更多说明

- [手记、精选与短笺说明](docs/writing-content.md)
- [音乐目录说明](public/music/README.md)
- [表盘图片说明](public/images/README.md)
- [Astro 官方文档](https://docs.astro.build/)
- [Astro Markdown 指南](https://docs.astro.build/en/guides/markdown-content/)
- [Astro 内容集合指南](https://docs.astro.build/en/guides/content-collections/)

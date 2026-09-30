# 浏览器测试

所有命令从仓库根目录运行。首次安装：

```sh
npm ci
npx playwright install chromium
npm run build
```

Linux CI 首次安装浏览器时使用 `npx playwright install --with-deps chromium`。
测试默认使用 Playwright 配套的 Chromium，不要求安装 Edge。
截图和报告自动写入已被 Git 忽略的 `qa/` 目录。

## 离线成品测试

这些脚本打开动态生成的本地文件 URL，无需启动服务器：

```sh
node tests/regression.cjs
node tests/interaction-check.cjs
node tests/touch-check.cjs
node tests/controls-check.cjs
```

`regression.cjs` 和 `controls-check.cjs` 默认检查 `成品/慢慢切.html`；
另两个脚本默认检查根目录 `index.html`。

## 托管页面测试

另开终端运行 `npm start`，再执行需要的测试：

```sh
node tests/browser-check.cjs
node tests/layout-check.cjs
node tests/shop-smoke.cjs
node tests/campaign-physics.cjs
node tests/campaign-playthrough.cjs
```

默认地址为 `http://127.0.0.1:4173/`。完整战役验收会实际切割、装盘并提交全部 24 单，耗时较长。
战役脚本仅用独立浏览器里的存档夹具解锁待测订单；游戏操作仍使用鼠标、键盘和页面按钮。

## 可选环境变量

| 变量 | 用途 |
| --- | --- |
| `GAME_URL` | 托管页面测试的地址。 |
| `GAME_FILE` | 离线测试的 HTML 路径；相对路径从当前工作目录解析。 |
| `PLAYWRIGHT_PACKAGE` | 自定义 Playwright 模块路径；默认使用项目安装的 `playwright`。 |
| `BROWSER_PATH` | 自定义 Chromium 系浏览器可执行文件路径；默认使用 Playwright 配套浏览器。 |
| `CAMPAIGN_LEVELS` | 战役验收订单编号，以逗号分隔，例如 `1,10,24`。 |
| `CAMPAIGN_RESUME` | 值为 `1` 时将战役重测结果合并进同一构建的既有报告；不同构建会拒绝合并。 |
| `TEST_FILTER` | 仅运行名称包含指定文本的交互测试。 |

每个测试保留独立的浏览器或上下文，不会访问日常浏览器的账号和存档。

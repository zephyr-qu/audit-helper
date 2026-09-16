# 开发说明

开发、测试与内部实现说明，面向前端开发者。

## 环境要求

需要 Node `^20.19.0 || >=22.12.0`（Vite 8 / Vitest 5 的要求）。

```bash
npm install
npm run dev      # 开发模式，产出 .output/chrome-mv3-dev
npm run build    # 生产构建，产出 .output/chrome-mv3
npm run compile  # vue-tsc 类型检查
npm test         # vitest（jsdom 环境）单元测试
npm run bench    # 高亮器的微基准
npm run zip      # 打包成可上传的 zip
```

## 加载扩展

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 「加载已解压的扩展程序」，选择 `.output/chrome-mv3-dev`（开发）或 `.output/chrome-mv3`（生产）。
3. 改完代码后需要在扩展页点「重新加载」，并刷新目标页面，content script 才会更新。


## 测试

单元测试与实现同目录（`utils/*.test.ts`），跑在 jsdom 环境，用 `utils/test-fixtures.ts` 里的 `makeSettings` / `makeStats` 造数据。

| 模块 | 覆盖内容 |
|---|---|
| `highlighter` | 合并正则的两条管线、跨组去重、非法正则、中英文整词边界（含中英混排、标点包围、下划线/连字符、字母与数字粘连）；批次上限与续扫锚点、隐藏内容过滤、`clear` 还原 DOM、清单排序、内置规则包集成 |
| `settings` | 档位归一化与各类兜底、站点匹配三种模式、词库文本与右键选中文本的解析差异 |
| `verdict` | 各档结论分支（含隐藏命中、扫描未跑完）、审核意见的分组顺序与注脚 |
| `page-styles` | 外观推导、CSS 选择器转义、非法色值兜底 |

`content.ts` 的消息接线、`MutationObserver` 与续扫调度**不在测试范围内**，改动后需要真机验证（重载扩展 → 刷新页面）。

## 目录结构

```
entrypoints/
  content.ts        内容脚本：扫描、高亮、面板接线、分批续扫调度
  background.ts     后台：角标汇总、跨 frame 汇总、右键菜单
  popup/            设置弹窗（App.vue + 三个标签页）
components/
  AuditPanel.vue    页内审查面板
  popup/            词库分组、处置档位组件
utils/
  highlighter.ts    TreeWalker 扫描 + 合并正则匹配 + 高亮 + 分批续扫
  compliance-pack.ts 内置规则包
  verdict.ts        结论推导与审核意见生成
  settings.ts       配置读写、归一化、迁移
  page-styles.ts    高亮外观推导与页面级 CSS 注入
  panel-state.ts    面板与内容脚本共享的响应式状态
  messages.ts       消息类型定义
  scroll.ts         滚动定位（含嵌套滚动容器兜底）
  clipboard.ts      复制到剪贴板（含回退）
  types.ts          共享类型
  *.test.ts         与实现同目录的单元测试
  test-fixtures.ts  测试夹具
bench/              高亮器微基准
public/icon/        扩展图标
vitest.config.ts    测试配置
wxt.config.ts       扩展构建配置
```

## 实现要点

- **跳过规则**：`script` / `style` / `contenteditable` 等标签，以及带 `data-kwa-ignore` 属性的容器，不参与扫描；插件自身插入的高亮节点（`data-kwa-mark`）与面板（`kwa-panel`）也跳过。
- **分批续扫**：单页扫描分批进行（默认每批 20000 个文本节点），触达上限后会在空闲时间自动续扫；只有续扫锚点被页面改动弄丢时才会停下，并提示「扫描未跑完，结果可能不完整」。
- **命中优先级**：同一分组内前缀重叠时（如「押金」与「押金退还」）取**更长**的词；跨分组时取**先声明**的分组，与词长无关——规则包的分组顺序是从重到轻，所以结论始终按最严重的那类问题给出。
- **英文整词口径**：下划线算词内（`user_spa_name` 不命中）、连字符算分隔（`a-spa-b` 命中）。

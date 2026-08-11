# TE-bookshelf MCP

把 te-bookshelf 后端包成 Evan 能调用的 MCP 工具。

## 部署到 VPS

服务由 GitHub Actions 自动部署到 VPS 的 `/srv/te/bookshelf-mcp`。部署细节见 `docs/github-actions-deploy.md`。

VPS `.env` 需要两个变量：

- `BACKEND_URL` = `https://te-bookshelf.vercel.app`（注意没有末尾斜杠）
- `SHARED_PASSWORD` = 与 bookshelf 相同的共享密码

推送到 `main` 后，工作流会同步代码、保留 VPS `.env`、安装生产依赖并重启 `bookshelf-mcp` 服务。

## 在 Claude 端接入

Claude 应用 → Settings → Connectors → Add custom connector

- Name: TE-bookshelf
- URL: `https://你的-MCP-域名/mcp`（末尾要 `/mcp`）

接入后 Evan 除了读书、批注与书签工具，还可以：

- `list_books` 列书架
- `read_book_toc` 读目录
- `read_chapter` 读某一章 + 看到所有批注
- `write_annotation` 在某段留批注
- `lookup_word` 在线查中文或英文词语
- `list_words` 读取 Evan 自己的中/英文单词本
- `save_word` 收藏词语并自动记录原文来源
- `remove_word` 从 Evan 的单词本删除词语

## 本地测试

```bash
BACKEND_URL=https://te-bookshelf.vercel.app SHARED_PASSWORD=woyoushujiale npm start
```

然后打开 http://localhost:3000 应该看到 `{"status":"ok",...}`

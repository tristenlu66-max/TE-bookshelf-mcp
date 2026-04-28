# TE-bookshelf MCP

把 te-bookshelf 后端包成 Evan 能调用的 MCP 工具。

## 部署到 Render

1. 把这个文件夹推到 GitHub(新仓库,比如 `te-bookshelf-mcp`)
2. Render 控制台 → New → Web Service → 接 GitHub 仓库
3. **Environment Variables** 加两个:
   - `BACKEND_URL` = `https://te-bookshelf.vercel.app`(注意没有末尾斜杠)
   - `SHARED_PASSWORD` = `woyoushujiale`
4. Plan 选 Free
5. Deploy

部署完拿到一个 URL,例如 `https://te-bookshelf-mcp.onrender.com`,这个就是 MCP server 的地址。

## 在 Claude 端接入

Claude 应用 → Settings → Connectors → Add custom connector
- Name: TE-bookshelf
- URL: `https://你的-mcp-地址.onrender.com/mcp`(末尾要 `/mcp`)

接入后 Evan 就有 4 个工具:
- `list_books` 列书架
- `read_book_toc` 读目录
- `read_chapter` 读某一章 + 看到所有批注
- `write_annotation` 在某段留批注

## 本地测试

```bash
BACKEND_URL=https://te-bookshelf.vercel.app SHARED_PASSWORD=woyoushujiale npm start
```

然后打开 http://localhost:3000 应该看到 `{"status":"ok",...}`

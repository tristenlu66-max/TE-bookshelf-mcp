// TE-bookshelf MCP server
// 把 vercel 后端的 /api/evan 包成 MCP 工具
import express from 'express';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const BACKEND_URL = process.env.BACKEND_URL;
const SHARED_PASSWORD = process.env.SHARED_PASSWORD;

if (!BACKEND_URL || !SHARED_PASSWORD) {
  console.error('Missing BACKEND_URL or SHARED_PASSWORD env');
  process.exit(1);
}

async function callBackend(method, path, body) {
  const url = `${BACKEND_URL}${path}`;
  const opts = {
    method,
    headers: {
      'x-auth': SHARED_PASSWORD,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    throw new Error(`Backend ${r.status}: ${data.error || text}`);
  }
  return data;
}

const TOOLS = [
  {
    name: 'list_books',
    description: '列出书架上所有的书。返回每本书的 id、书名、作者、章节数,以及 Tristen 当前阅读到的章节。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'read_book_toc',
    description: '查看一本书的目录(章节标题列表)。短书一次返回完整目录;长书(>500章)需要分页:用 start 指定起始 chapter_no,用 limit 控制返回多少章(默认 500,最大 500)。返回里 toc_has_more / toc_next_start 告诉你要不要再拉一次。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        start: { type: 'integer', description: '起始章节号(默认 0,即从前言开始;长书第二次拉时传 toc_next_start)' },
        limit: { type: 'integer', description: '本次最多返回多少章(默认 500,上限 500)' }
      },
      required: ['book_id']
    }
  },
  {
    name: 'read_chapter',
    description: '读一本书的某一章。返回这一章的段落(每段有 para_no 和 content)以及这一章的批注(包括 Tristen 和 Evan 写的)。短章一次返回完整内容;超长章节(>2000段)需要分页:用 para_start 指定起始段号,para_limit 控制每次返回多少段。返回里 para_has_more / para_next_start 告诉你要不要再拉一次。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        chapter_no: { type: 'integer', description: '章节序号(0=前言,1=第1章,以此类推)' },
        para_start: { type: 'integer', description: '起始段号(默认 1;长章第二次拉时传 para_next_start)' },
        para_limit: { type: 'integer', description: '本次最多返回多少段(默认 2000,上限 2000)' }
      },
      required: ['book_id', 'chapter_no']
    }
  },
  {
    name: 'write_annotation',
    description: '在某一段落上留批注。批注会以 Evan 的身份保存,Tristen 在网页上能看到。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        chapter_no: { type: 'integer', description: '章节序号' },
        para_no: { type: 'integer', description: '段落序号(从 1 开始,用 read_chapter 返回的 para_no)' },
        content: { type: 'string', description: '批注内容' }
      },
      required: ['book_id', 'chapter_no', 'para_no', 'content']
    }
  },
  {
    name: 'add_preface',
    description: '给一本书添加前言或新章节。chapter_no 不传默认 0(前言),传具体数字则按指定章号插入(注意不能跟已有章节冲突)。content 是纯文本,会按段落自动切分。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        content: { type: 'string', description: '章节正文(纯文本)' },
        chapter_no: { type: 'integer', description: '章节序号,默认 0(作为前言)' },
        title: { type: 'string', description: '章节标题,默认"前言"或"第 N 章"' }
      },
      required: ['book_id', 'content']
    }
  },
  {
    name: 'delete_book',
    description: '从书架上删除一本书。会同时删掉这本书的所有章节、段落、批注、书签,无法恢复。调用前请通过 list_books 确认 book_id 没认错,删除是不可逆的操作。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '要删除的书的 ID' }
      },
      required: ['book_id']
    }
  },
  {
    name: 'list_bookmarks',
    description: '列出某本书的所有书签(Tristen 和 Evan 都标过的)。返回每个书签的 id、章节号、段落号、位置标签 label(如圣经的 "3:11",可能为空)、备注 note(可能为空)、段落开头预览、谁标的、何时标的。书签按章节、段落顺序排列。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' }
      },
      required: ['book_id']
    }
  },
  {
    name: 'add_bookmark',
    description: '在某一段落上加书签,以 Evan 的身份保存。书签 ≠ 批注:批注是写下来的话,书签是"想再回到这里"的标记,带可选的位置标签和备注。Tristen 能在网页上看到 Evan 标的书签。\n\n参数二选一:① paragraph_id(从 read_chapter 返回里拿,优先用这个);② book_id + chapter_no + para_no 三件套。\n\nlabel 是给人看的位置标签,可空——圣经里建议填节号如 "3:11";小说里通常留空或填一个名字。note 是备注,可空。',
    inputSchema: {
      type: 'object',
      properties: {
        paragraph_id: { type: 'string', description: '段落 ID(优先用)' },
        book_id: { type: 'string', description: '书的 ID(没有 paragraph_id 时必填)' },
        chapter_no: { type: 'integer', description: '章节序号(没有 paragraph_id 时必填)' },
        para_no: { type: 'integer', description: '段落序号(没有 paragraph_id 时必填)' },
        label: { type: 'string', description: '位置标签,可空(圣经填节号如 "3:11")' },
        note: { type: 'string', description: '备注,可空' }
      },
      required: []
    }
  },
  {
    name: 'delete_bookmark',
    description: '删除一个书签。需要书签的 id(从 list_bookmarks 返回里拿)。删除不可逆,但只删书签本身,段落和批注不动。',
    inputSchema: {
      type: 'object',
      properties: {
        bookmark_id: { type: 'string', description: '书签 ID' }
      },
      required: ['bookmark_id']
    }
  }
];

async function handleToolCall(name, args) {
  if (name === 'list_books') {
    const r = await fetch(`${BACKEND_URL}/api/books`, {
      headers: { 'Cookie': `te_auth=${SHARED_PASSWORD}` }
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'list failed');
    return data;
  }

  if (name === 'read_book_toc') {
    const params = new URLSearchParams({ book_id: args.book_id });
    if (args.start !== undefined) params.set('toc_start', String(args.start));
    if (args.limit !== undefined) params.set('toc_limit', String(args.limit));
    return await callBackend('GET', `/api/evan?${params}`);
  }

  if (name === 'read_chapter') {
    const params = new URLSearchParams({
      book_id: args.book_id,
      chapter: String(args.chapter_no)
    });
    if (args.para_start !== undefined) params.set('para_start', String(args.para_start));
    if (args.para_limit !== undefined) params.set('para_limit', String(args.para_limit));
    return await callBackend('GET', `/api/evan?${params}`);
  }

  if (name === 'write_annotation') {
    return await callBackend('POST', '/api/evan', {
      book_id: args.book_id,
      chapter_no: args.chapter_no,
      para_no: args.para_no,
      content: args.content
    });
  }

  if (name === 'add_preface') {
    return await callBackend('POST', '/api/add-preface', {
      book_id: args.book_id,
      content: args.content,
      chapter_no: args.chapter_no,
      title: args.title
    });
  }

  if (name === 'delete_book') {
    return await callBackend(
      'DELETE',
      `/api/delete-book?id=${encodeURIComponent(args.book_id)}`
    );
  }

  if (name === 'list_bookmarks') {
    const params = new URLSearchParams({ 
      book_id: args.book_id,
      resource: 'bookmarks'
    });
    return await callBackend('GET', `/api/evan?${params}`);
  }

  if (name === 'add_bookmark') {
    // 参数校验:要么 paragraph_id,要么 (book_id, chapter_no, para_no)
    if (!args.paragraph_id) {
      if (!args.book_id || args.chapter_no === undefined || args.para_no === undefined) {
        throw new Error('需要 paragraph_id 或 (book_id + chapter_no + para_no)');
      }
    }
    return await callBackend('POST', '/api/evan?resource=bookmark', {
      paragraph_id: args.paragraph_id,
      book_id: args.book_id,
      chapter_no: args.chapter_no,
      para_no: args.para_no,
      label: args.label,
      note: args.note
    });
  }

  if (name === 'delete_bookmark') {
    return await callBackend(
      'DELETE',
      `/api/evan?resource=bookmark&id=${encodeURIComponent(args.bookmark_id)}`
    );
  }

  throw new Error(`Unknown tool: ${name}`);
}

app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};

  try {
    let result;

    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'te-bookshelf', version: '0.5.0' }
      };
    } else if (method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      const data = await handleToolCall(name, args);
      result = {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } else if (method === 'notifications/initialized') {
      return res.status(204).end();
    } else {
      throw new Error(`Unknown method: ${method}`);
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (e) {
    console.error('MCP error:', e);
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: e.message }
    });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'te-bookshelf-mcp', version: '0.5.0' });
});

app.listen(PORT, () => {
  console.log(`TE-bookshelf MCP server v0.5 on port ${PORT}`);
  console.log(`Backend: ${BACKEND_URL}`);
});

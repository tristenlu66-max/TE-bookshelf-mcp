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
    description: '查看一本书的目录(所有章节标题)。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' }
      },
      required: ['book_id']
    }
  },
  {
    name: 'read_chapter',
    description: '读一本书的某一章。返回这一章的所有段落(每段有 para_no 和 content),以及这一章里所有已有的批注(包括 Tristen 和 Evan 写的)。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        chapter_no: { type: 'integer', description: '章节序号(0=前言,1=第1章,以此类推)' }
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
    return await callBackend('GET', `/api/evan?book_id=${encodeURIComponent(args.book_id)}`);
  }
  
  if (name === 'read_chapter') {
    return await callBackend('GET', 
      `/api/evan?book_id=${encodeURIComponent(args.book_id)}&chapter=${args.chapter_no}`);
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
        serverInfo: { name: 'te-bookshelf', version: '0.2.0' }
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
  res.json({ status: 'ok', service: 'te-bookshelf-mcp', version: '0.2.0' });
});

app.listen(PORT, () => {
  console.log(`TE-bookshelf MCP server v0.2 on port ${PORT}`);
  console.log(`Backend: ${BACKEND_URL}`);
});

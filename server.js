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
      'x-vocabulary-owner': 'evan',
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
    description: '读一本书的某一章。返回这一章的段落(每段有 para_no 和 content;marks.em 是着重/斜体的字符范围)、这一章的脚注(footnotes:所在段落、编号、注释内容)以及批注(包括 Tristen 和 Evan 写的)。短章一次返回完整内容;超长章节(>2000段)需要分页:用 para_start 指定起始段号,para_limit 控制每次返回多少段。返回里 para_has_more / para_next_start 告诉你要不要再拉一次。',
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
    description: '以 Evan 身份写批注或回复，Tristen 在网页上能看到。四种写法：①段落批注：book_id + chapter_no + para_no + content；②书级批注：book_id + content；③章级批注：book_id + chapter_no + content（不传 para_no）；④回复：parent_id + content。parent_id 从 read_chapter 返回的 annotations 中获取。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID。书级、章级、段落批注时需要；回复时不需要。' },
        chapter_no: { type: 'integer', description: '章节序号。章级、段落批注时需要；只传到此处且不传 para_no 即为章级批注。' },
        para_no: { type: 'integer', description: '段落序号（从 1 开始）。传入时为段落批注。' },
        parent_id: { type: 'string', description: '要回复的批注 ID（从 read_chapter 返回的 annotations 获取）。传入时创建回复。' },
        content: { type: 'string', description: '批注内容' }
      },
      required: ['content']
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
  },
  {
    name: 'edit_annotation',
    description: '编辑 Evan 自己写的一条批注(创建后 10 分钟内可编辑,超时不可改)。需要批注的 id(从 read_chapter 返回的 annotations 里拿)和新的内容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '批注 ID' },
        content: { type: 'string', description: '新的批注内容' }
      },
      required: ['id', 'content']
    }
  },
  {
    name: 'delete_annotation',
    description: '删除 Evan 自己写的一条批注(创建后 10 分钟内可删除,超时不可删)。需要批注的 id(从 read_chapter 返回的 annotations 里拿)。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '批注 ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'lookup_word',
    description: '在线查询中文或英文词语。中文返回中文释义；英文返回英中双语释义（Azure 未配置时至少返回英英释义）。',
    inputSchema: {
      type: 'object',
      properties: { term: { type: 'string', description: '要查询的词或短语' } },
      required: ['term']
    }
  },
  {
    name: 'list_words',
    description: '查看 Evan 自己的单词本。按语言返回已收藏的词和全部来源。',
    inputSchema: { type: 'object', properties: { language: { type: 'string', enum: ['en', 'zh'], description: '英文或中文分区' } }, required: ['language'] }
  },
  {
    name: 'save_word',
    description: '把一个词收藏到 Evan 的单词本。来源必须指向书中一段；后端会从原文自动提取完整来源句子。',
    inputSchema: { type: 'object', properties: { term:{type:'string',description:'词或短语'}, language:{type:'string',enum:['en','zh']}, book_id:{type:'string'}, chapter_no:{type:'integer'}, paragraph_id:{type:'string'}, selection_start:{type:'integer',description:'词在段落中的起始字符位置，可选'}, selection_end:{type:'integer',description:'词在段落中的结束字符位置，可选'} }, required:['term','language','book_id','chapter_no','paragraph_id'] }
  },
  {
    name: 'remove_word',
    description: '从 Evan 的单词本删除一个词及其来源。',
    inputSchema: { type:'object', properties:{term:{type:'string'},language:{type:'string',enum:['en','zh']}}, required:['term','language'] }
  },
  {
    name: 'get_people',
    description: '读一本书的人名表。阅读器用它给人名画下划线、点开弹人物卡片。返回 characters(每人的叫法、颜色、按章节解锁的卡片和关系)、never_alone(单独出现时不上色的词),以及 source:saved=数据库里的,seed=随代码带来的初版。',
    inputSchema: {
      type: 'object',
      properties: { book_id: { type: 'string', description: '书的 ID' } },
      required: ['book_id']
    }
  },
  {
    name: 'upsert_person',
    description: '在人名表里新增或改写一个人物(按 id 覆盖),其他人不动。新人物出场、卡片要随剧情往后补一句时用这个。aliases 一定要按书架上这一版的译名核对过再写。卡片按 from_chapter 分条写,只写读到那一章为止知道的事,不剧透。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        person: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '人物 id,只用字母数字下划线,如 raskolnikov' },
            tier: { type: 'string', enum: ['main', 'minor'], description: 'main=彩色实线(一本书最多七八个),minor=灰色虚线' },
            color: { type: 'string', description: 'main 用的颜色 #rrggbb;别用红 #bc4749/#8b2d2d(Evan 批注)和金 #c4a882/#8a6c3a(Tristen 批注)' },
            style: { type: 'string', enum: ['solid', 'wavy', 'double', 'dashed'], description: '下划线样式,默认 solid' },
            display: { type: 'string', description: '卡片上显示的名字' },
            aliases: { type: 'array', items: { type: 'string' }, description: '书里出现过的每一种叫法(全名、父称连用、昵称),至少两个字;按这一版译名写' },
            first_chapter: { type: 'integer', description: '第一次出场的 chapter_no' },
            card: {
              type: 'array',
              description: '卡片内容,读到 from_chapter 才显示,用来防剧透',
              items: { type: 'object', properties: { from_chapter: { type: 'integer' }, text: { type: 'string' } }, required: ['from_chapter', 'text'] }
            },
            relations: {
              type: 'array',
              items: { type: 'object', properties: { to: { type: 'string', description: '对方的 id' }, label: { type: 'string', description: '对方是他的什么,如 妹妹' }, from_chapter: { type: 'integer' } }, required: ['to', 'label'] }
            }
          },
          required: ['id', 'display', 'aliases']
        }
      },
      required: ['book_id', 'person']
    }
  },
  {
    name: 'remove_person',
    description: '从人名表里删掉一个人物,别人指向他的关系会一起去掉。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        person_id: { type: 'string', description: '要删的人物 id' }
      },
      required: ['book_id', 'person_id']
    }
  },
  {
    name: 'set_people',
    description: '整张替换一本书的人名表。一次性建表或大改时用;平时增改一个人请用 upsert_person。',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: '书的 ID' },
        never_alone: { type: 'array', items: { type: 'string' }, description: '单独出现时不上色的词,如几个人共用的父称' },
        characters: { type: 'array', items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '人物 id,只用字母数字下划线,如 raskolnikov' },
            tier: { type: 'string', enum: ['main', 'minor'], description: 'main=彩色实线(一本书最多七八个),minor=灰色虚线' },
            color: { type: 'string', description: 'main 用的颜色 #rrggbb;别用红 #bc4749/#8b2d2d(Evan 批注)和金 #c4a882/#8a6c3a(Tristen 批注)' },
            style: { type: 'string', enum: ['solid', 'wavy', 'double', 'dashed'], description: '下划线样式,默认 solid' },
            display: { type: 'string', description: '卡片上显示的名字' },
            aliases: { type: 'array', items: { type: 'string' }, description: '书里出现过的每一种叫法(全名、父称连用、昵称),至少两个字;按这一版译名写' },
            first_chapter: { type: 'integer', description: '第一次出场的 chapter_no' },
            card: {
              type: 'array',
              description: '卡片内容,读到 from_chapter 才显示,用来防剧透',
              items: { type: 'object', properties: { from_chapter: { type: 'integer' }, text: { type: 'string' } }, required: ['from_chapter', 'text'] }
            },
            relations: {
              type: 'array',
              items: { type: 'object', properties: { to: { type: 'string', description: '对方的 id' }, label: { type: 'string', description: '对方是他的什么,如 妹妹' }, from_chapter: { type: 'integer' } }, required: ['to', 'label'] }
            }
          },
          required: ['id', 'display', 'aliases']
        } }
      },
      required: ['book_id', 'characters']
    }
  },
  {
    name: 'search',
    description: '搜索书架上的内容。可以搜批注、正文或两者。支持全局搜索(所有书)和书内搜索(指定 book_id)。返回匹配的批注和/或正文段落,包含所在的书名、章节名、段落号,最多 50 条结果。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '搜索关键词' },
        book_id: { type: 'string', description: '限定在某本书内搜索(可选,不传则全局搜)' },
        scope: { type: 'string', enum: ['all', 'annotations', 'paragraphs'], description: '搜索范围:all=批注+正文(默认),annotations=只搜批注,paragraphs=只搜正文' }
      },
      required: ['q']
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
    if (!args.content || !args.content.trim()) {
      throw new Error('需要 content');
    }
    if (args.parent_id) {
      return await callBackend('POST', '/api/evan', {
        parent_id: args.parent_id,
        content: args.content
      });
    }
    if (!args.book_id) {
      throw new Error('书级、章级和段落批注需要 book_id；回复请传 parent_id');
    }
    if (args.para_no !== undefined && args.chapter_no === undefined) {
      throw new Error('段落批注需要 chapter_no 和 para_no');
    }
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

  if (name === 'edit_annotation') {
    return await callBackend('PUT', '/api/evan?resource=annotation', {
      id: args.id,
      content: args.content
    });
  }

  if (name === 'delete_annotation') {
    return await callBackend(
      'DELETE',
      `/api/evan?resource=annotation&id=${encodeURIComponent(args.id)}`
    );
  }

  if (name === 'get_people') {
    const params = new URLSearchParams({ resource: 'people', book_id: args.book_id });
    return await callBackend('GET', `/api/evan?${params}`);
  }

  if (name === 'set_people') {
    return await callBackend('PUT', '/api/evan?resource=people', {
      book_id: args.book_id,
      data: { never_alone: args.never_alone || [], characters: args.characters || [] }
    });
  }

  if (name === 'upsert_person' || name === 'remove_person') {
    const params = new URLSearchParams({ resource: 'people', book_id: args.book_id });
    const current = (await callBackend('GET', `/api/evan?${params}`)).people || { never_alone: [], characters: [] };
    let characters = current.characters || [];
    let changed;
    if (name === 'upsert_person') {
      const person = args.person || {};
      if (!person.id) throw new Error('person 需要 id');
      const existed = characters.some(item => item.id === person.id);
      characters = existed
        ? characters.map(item => (item.id === person.id ? person : item))
        : [...characters, person];
      changed = `${existed ? '改写' : '新增'} ${person.id}`;
    } else {
      if (!characters.some(item => item.id === args.person_id)) throw new Error(`人名表里没有 ${args.person_id}`);
      characters = characters
        .filter(item => item.id !== args.person_id)
        .map(item => ({ ...item, relations: (item.relations || []).filter(rel => rel.to !== args.person_id) }));
      changed = `删除 ${args.person_id}`;
    }
    const saved = await callBackend('PUT', '/api/evan?resource=people', {
      book_id: args.book_id,
      data: { never_alone: current.never_alone || [], characters }
    });
    return { ok: true, changed, count: saved.count };
  }

  if (name === 'search') {
    const params = new URLSearchParams({ q: args.q });
    if (args.book_id) params.set('book_id', args.book_id);
    if (args.scope) params.set('scope', args.scope);
    params.set('resource', 'search');
    return await callBackend('GET', `/api/evan?${params}`);
  }

  if (name === 'list_words') return await callBackend('GET', `/api/words?language=${encodeURIComponent(args.language)}`);
  if (name === 'lookup_word') return await callBackend('GET', `/api/dictionary?q=${encodeURIComponent(args.term)}`);
  if (name === 'save_word') return await callBackend('POST', '/api/words', args);
  if (name === 'remove_word') return await callBackend('DELETE', '/api/words', args);

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
        serverInfo: { name: 'te-bookshelf', version: '0.9.0' }
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
  res.json({ status: 'ok', service: 'te-bookshelf-mcp', version: '0.9.0' });
});

app.listen(PORT, () => {
  console.log(`TE-bookshelf MCP server v0.9 on port ${PORT}`);
  console.log(`Backend: ${BACKEND_URL}`);
});

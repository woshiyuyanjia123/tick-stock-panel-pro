#!/usr/bin/env node
/**
 * 24x7 Fu Peng Global Macro & FICC Intel Watcher (EGO Browser Daemon / Standalone CLI)
 *
 * Usage (with ego-browser.exe isolated silent TaskSpace):
 *   ego-browser --ego-server-name=tsp-fupeng-watcher nodejs -e "await import('./scripts/ego_fupeng_24h_watcher.mjs')"
 *
 * Usage (standalone Node v24 CLI, single run or 24h daemon):
 *   node scripts/ego_fupeng_24h_watcher.mjs --once
 *   node scripts/ego_fupeng_24h_watcher.mjs --once --dry-run
 *   node scripts/ego_fupeng_24h_watcher.mjs --interval=600
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const OUT_JSONL = path.join(DATA_DIR, 'fupeng_ego_feed.jsonl');
const MAX_LINES = 300;
const API_BASE = process.env.TSP_API_BASE || 'http://127.0.0.1:3130';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const EGO_SEARCH_PAGES = [
  {
    id: 'wscn_web',
    label: '华尔街见闻-付鹏搜索页',
    url: 'https://wallstreetcn.com/search?q=%E4%BB%98%E9%B9%8F',
  },
  {
    id: 'bili_web',
    label: 'Bilibili-付鹏最新视频页',
    url: 'https://search.bilibili.com/video?keyword=%E4%BB%98%E9%B9%8F&order=pubdate',
  },
  {
    id: 'weibo_web',
    label: '微博-付鹏财经搜索页',
    url: 'https://s.weibo.com/weibo?q=%E4%BB%98%E9%B9%8F',
  },
  {
    id: 'douyin_web',
    label: '抖音-付鹏宏观搜索页',
    url: 'https://www.douyin.com/search/%E4%BB%98%E9%B9%8F?type=video',
  },
];

function decodeClean(raw) {
  return String(raw || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRelevantFupeng(title, summary) {
  const txt = `${title} ${summary}`;
  if (!txt.includes('付鹏')) return false;
  if (!/(付鹏说|东北证券|宏观|经济|黄金|美债|美元|利率|汇率|日元|套息|大宗|原油|铜|AI|算力|资产|哑铃|红利|港股|美股|商品|流动性)/i.test(txt)) {
    return false;
  }
  if (/(断供|法拍|律师|借贷纠纷)/.test(txt) && !/(付鹏说|宏观|FICC|东北证券)/.test(txt)) {
    return false;
  }
  return true;
}

async function fetchWithTimeout(url, headers = {}, timeoutMs = 4500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function loadExistingUrls() {
  const urls = new Set();
  if (!fs.existsSync(OUT_JSONL)) return urls;
  try {
    const lines = fs.readFileSync(OUT_JSONL, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const obj = JSON.parse(line);
      const list = Array.isArray(obj.items) ? obj.items : obj.url ? [obj] : [];
      for (const it of list) {
        if (it?.url) urls.add(String(it.url).split('#')[0]);
      }
    }
  } catch {
    // ignore read error
  }
  return urls;
}

function appendJsonl(record) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  let lines = [];
  if (fs.existsSync(OUT_JSONL)) {
    lines = fs
      .readFileSync(OUT_JSONL, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
  }
  lines.push(JSON.stringify(record));
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
  }
  fs.writeFileSync(OUT_JSONL, `${lines.join('\n')}\n`, 'utf8');
}

async function scrapeViaEgoBrowser() {
  const space = await globalThis.taskSpace('tsp-fupeng-24h-watcher');
  let page = null;
  const items = [];
  const channelLogs = [];

  try {
    const existingPages = await space.pages();
    page = existingPages[0] || (await space.newPage());

    for (const target of EGO_SEARCH_PAGES) {
      const t0 = Date.now();
      try {
        await page.goto(target.url, { timeout: 10000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1600);
        const rows = await page.evaluate(() => {
          const out = [];
          const links = Array.from(document.querySelectorAll('a[href]'));
          for (const a of links) {
            const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
            const href = a.href || '';
            if (text.includes('付鹏') && text.length >= 8 && href.startsWith('http')) {
              const cardText = (a.closest('article, div, li')?.textContent || text)
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, 260);
              out.push({ title: text.slice(0, 140), summary: cardText, url: href });
            }
            if (out.length >= 10) break;
          }
          return out;
        });

        let added = 0;
        for (const r of rows) {
          if (isRelevantFupeng(r.title, r.summary)) {
            added++;
            items.push({
              ...r,
              publishedAt: new Date().toISOString(),
              source: target.label,
            });
          }
        }
        channelLogs.push({ id: target.id, ok: true, latencyMs: Date.now() - t0, hits: added });
      } catch (err) {
        channelLogs.push({
          id: target.id,
          ok: false,
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    try {
      if (page && page.close) await page.close();
    } catch {
      // ignore
    }
    try {
      if (space && space.finish) await space.finish({ keep: false });
    } catch {
      // ignore
    }
  }

  return { mode: 'ego-browser-taskspace', channelLogs, items };
}

async function scrapeStandaloneDirect() {
  const items = [];
  const channelLogs = [];

  // 1. WallstreetCN 《付鹏说》
  const tWscn = Date.now();
  try {
    const raw = await fetchWithTimeout(
      'https://api-one-wscn.awtmt.com/apiv1/search/article?query=%E4%BB%98%E9%B9%8F&limit=10',
      { Referer: 'https://wallstreetcn.com/' }
    );
    const json = JSON.parse(raw);
    const list = Array.isArray(json?.data?.items) ? json.data.items : [];
    let hits = 0;
    for (const it of list) {
      const title = decodeClean(it.title);
      const summary = decodeClean(it.content_short || it.content || title);
      const url = String(it.uri || '').split('?keyword=')[0];
      if (title && url && isRelevantFupeng(title, summary)) {
        hits++;
        items.push({
          title,
          summary,
          url,
          publishedAt: it.display_time ? new Date(Number(it.display_time) * 1000).toISOString() : new Date().toISOString(),
          source: '华尔街见闻',
        });
      }
    }
    channelLogs.push({ id: 'wscn', ok: true, latencyMs: Date.now() - tWscn, hits });
  } catch (err) {
    channelLogs.push({ id: 'wscn', ok: false, latencyMs: Date.now() - tWscn, error: err.message });
  }

  // 2. Bilibili Fu Peng Video Search
  const tBili = Date.now();
  try {
    const raw = await fetchWithTimeout(
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E4%BB%98%E9%B9%8F&order=pubdate&page=1',
      { Referer: 'https://search.bilibili.com/', Cookie: 'buvid3=TSP-FUPENG-24H-WATCHER-0001infoc;' }
    );
    const json = JSON.parse(raw);
    const list = Array.isArray(json?.data?.result) ? json.data.result : [];
    let hits = 0;
    for (const v of list.slice(0, 8)) {
      const title = decodeClean(v.title);
      const summary = decodeClean(v.description || title);
      const url = String(v.arcurl || (v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : '')).trim();
      if (title && url && isRelevantFupeng(title, `${summary} ${v.author || ''}`)) {
        hits++;
        items.push({
          title: `[B站视频] ${title}`,
          summary: summary || `UP主(${v.author || '宏观'})分享付鹏观点`,
          url,
          publishedAt: v.pubdate ? new Date(Number(v.pubdate) * 1000).toISOString() : new Date().toISOString(),
          source: 'Bilibili视频流',
        });
      }
    }
    channelLogs.push({ id: 'bilibili', ok: true, latencyMs: Date.now() - tBili, hits });
  } catch (err) {
    channelLogs.push({ id: 'bilibili', ok: false, latencyMs: Date.now() - tBili, error: err.message });
  }

  // 3. EastMoney News Search
  const tEm = Date.now();
  try {
    const param = JSON.stringify({
      uid: '',
      keyword: '付鹏',
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'default',
          pageIndex: 1,
          pageSize: 8,
          preTag: '',
          postTag: '',
        },
      },
    });
    const raw = await fetchWithTimeout(
      `https://search-api-web.eastmoney.com/search/jsonp?cb=emcb&param=${encodeURIComponent(param)}`,
      { Referer: 'https://so.eastmoney.com/' }
    );
    const m = raw.match(/^emcb\(([\s\S]*)\)$/s);
    const json = m ? JSON.parse(m[1]) : {};
    const list = Array.isArray(json?.result?.cmsArticleWebOld) ? json.result.cmsArticleWebOld : [];
    let hits = 0;
    for (const it of list) {
      const title = decodeClean(it.title);
      const summary = decodeClean(it.content || title);
      const url = String(it.url || '').trim();
      if (title && url && isRelevantFupeng(title, summary)) {
        hits++;
        items.push({
          title,
          summary,
          url,
          publishedAt: it.date || new Date().toISOString(),
          source: '东方财富资讯',
        });
      }
    }
    channelLogs.push({ id: 'eastmoney', ok: true, latencyMs: Date.now() - tEm, hits });
  } catch (err) {
    channelLogs.push({ id: 'eastmoney', ok: false, latencyMs: Date.now() - tEm, error: err.message });
  }

  // 4. Bing News RSS Probe
  const tBing = Date.now();
  try {
    const raw = await fetchWithTimeout(
      'https://www.bing.com/news/search?q=%E4%BB%98%E9%B9%8F&format=rss',
      { Accept: 'application/rss+xml, application/xml, text/xml, */*' }
    );
    const matches = raw.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    let hits = 0;
    for (const blk of matches) {
      const title = decodeClean((blk.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const url = decodeClean((blk.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
      const summary = decodeClean((blk.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || title);
      const pubDate = decodeClean((blk.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
      if (title && url && isRelevantFupeng(title, summary)) {
        hits++;
        items.push({
          title,
          summary,
          url,
          publishedAt: pubDate || new Date().toISOString(),
          source: 'BingRSS',
        });
      }
    }
    channelLogs.push({ id: 'bing_rss', ok: matches.length > 0, latencyMs: Date.now() - tBing, hits });
  } catch (err) {
    channelLogs.push({ id: 'bing_rss', ok: false, latencyMs: Date.now() - tBing, error: err.message });
  }

  return { mode: 'standalone-direct-rss-api', channelLogs, items };
}

async function syncNewItemsToServer(newItems) {
  if (!newItems.length) return { posted: 0, serverOnline: false };
  try {
    const hc = new AbortController();
    const t = setTimeout(() => hc.abort(), 2000);
    const health = await fetch(`${API_BASE}/api/health`, { signal: hc.signal });
    clearTimeout(t);
    if (!health.ok) return { posted: 0, serverOnline: false };
  } catch {
    return { posted: 0, serverOnline: false };
  }

  let posted = 0;
  for (const it of newItems.slice(0, 10)) {
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 3000);
      const res = await fetch(`${API_BASE}/api/fupeng/ingest-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: it.title,
          content: it.summary,
          sourceUrl: it.url,
        }),
        signal: c.signal,
      });
      clearTimeout(timer);
      if (res.ok) posted++;
    } catch {
      // ignore individual post error
    }
  }
  return { posted, serverOnline: true };
}

async function runCycle(dryRun) {
  const hasEgo = typeof globalThis.taskSpace === 'function';
  const result = hasEgo ? await scrapeViaEgoBrowser() : await scrapeStandaloneDirect();

  // Deduplicate by URL
  const seen = new Set();
  const deduped = [];
  for (const it of result.items) {
    const u = String(it.url || '').split('#')[0];
    if (!u || seen.has(u)) continue;
    seen.add(u);
    deduped.push(it);
  }

  const existingUrls = loadExistingUrls();
  const newItems = deduped.filter((it) => !existingUrls.has(String(it.url).split('#')[0]));

  const record = {
    timestamp: new Date().toISOString(),
    mode: dryRun ? `${result.mode}-dry-run` : result.mode,
    channelLogs: result.channelLogs,
    totalFetched: deduped.length,
    newlyDiscovered: newItems.length,
    items: newItems.length > 0 ? newItems : deduped.slice(0, 5),
  };

  if (!dryRun && deduped.length > 0) {
    appendJsonl(record);
  }

  const syncInfo = dryRun
    ? { posted: 0, serverOnline: false }
    : await syncNewItemsToServer(newItems);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outFile: OUT_JSONL,
        mode: record.mode,
        totalFetched: record.totalFetched,
        newlyDiscovered: record.newlyDiscovered,
        serverSync: syncInfo,
        channelLogs: record.channelLogs,
      },
      null,
      2
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const runOnce = args.includes('--once') || args.includes('--dry-run');
  const dryRun = args.includes('--dry-run');
  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const intervalSec = Math.max(60, Number(intervalArg?.split('=')[1] || 600));

  await runCycle(dryRun);
  if (runOnce) return;

  let stopping = false;
  const stop = () => {
    stopping = true;
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
    if (!stopping) {
      await runCycle(dryRun).catch((err) => {
        console.error('[ego_fupeng_24h_watcher] cycle error:', err);
      });
    }
  }
}

main().catch((err) => {
  console.error('[ego_fupeng_24h_watcher] fatal:', err);
  process.exitCode = 1;
});

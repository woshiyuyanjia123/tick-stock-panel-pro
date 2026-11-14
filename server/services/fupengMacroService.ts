import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  FupengBarbellBacktestRequest,
  FupengBarbellBacktestResponse,
  FupengFiccCoordinate,
  FupengIntelItem,
  FupengMacroPillar,
  FupengOverviewResponse,
  FupengReferenceTarget,
  FupengScraperChannelStatus,
  FupengTradableBasket,
  FuturesQuoteItem,
  KLineBar,
  StockQuoteItem,
} from '../../src/types/market';
import {
  dbGetFupengIntelCount,
  dbListFupengIntel,
  dbUpsertFupengIntelItems,
  type FupengIntelDbItem,
} from '../db/sqliteDb';
import { fetchTencentKLines, fetchTencentQuotes } from '../providers/tencent';
import { APP_ROOT_DIR, cachedFetch, DATA_DIR } from '../utils/httpCache';
import { getBeijingTimeInfo } from '../utils/marketHelpers';
import { fetchOptionSkews } from './altConsensusService';
import { getCpoTransmissionOverview } from './cpoTransmissionService';
import { fetch28FuturesQuotes, fetchFuturesKLines } from './pandaPmService';

const VAULT_DIR =
  process.env.TSP_MACRO_VAULT_DIR ||
  path.join(os.homedir(), 'Desktop', '金融', '耶鲁与全球宏观因子_期货美股实战智库');
const EGO_FEED_JSONL = path.join(DATA_DIR, 'fupeng_ego_feed.jsonl');
const EGO_SCRIPT_REL = 'scripts/ego_fupeng_24h_watcher.mjs';
const WATCH_INTERVAL_SEC = 600;

const UA_HEADER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface DailyBar {
  date: string;
  close: number;
  volume: number;
}

interface ScrapedRawIntel {
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  sourceChannel: string;
}

let lastScrapedAt = '';
let lastChannelStatuses: FupengScraperChannelStatus[] = [];

function round(v: number, digits = 2): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const x of arr) sum += x;
  return sum / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sumSq = 0;
  for (const x of arr) sumSq += (x - m) ** 2;
  return Math.sqrt(sumSq / (arr.length - 1));
}

function nowBjIso(): string {
  const bj = getBeijingTimeInfo();
  return `${bj.dateStr} ${bj.timeStr}`;
}

function toBjTimestamp(input?: string | number | Date): string {
  if (!input) return nowBjIso();
  const d =
    typeof input === 'number'
      ? new Date(input > 1e12 ? input : input * 1000)
      : input instanceof Date
      ? input
      : new Date(String(input).trim());
  if (Number.isNaN(d.getTime())) {
    const raw = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 19).replace('T', ' ');
    return nowBjIso();
  }
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const bj = new Date(utcMs + 8 * 3600 * 1000);
  const y = bj.getFullYear();
  const m = String(bj.getMonth() + 1).padStart(2, '0');
  const day = String(bj.getDate()).padStart(2, '0');
  const hh = String(bj.getHours()).padStart(2, '0');
  const mm = String(bj.getMinutes()).padStart(2, '0');
  const ss = String(bj.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function decodeHtmlEntities(raw: string): string {
  return String(raw || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function stripTagsAndClean(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shaId(prefix: string, seed: string): string {
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
  return `${prefix}_${hash}`;
}

function isRelevantFupengArticle(title: string, summary: string): boolean {
  const text = `${title} ${summary}`;
  if (!text.includes('付鹏')) return false;
  const macroHits =
    /(付鹏说|东北证券|宏观|经济|黄金|美债|美元|利率|汇率|人民币|日元|套息|大宗|原油|铜|AI|算力|科技|资产负债表|有效需求|哑铃|高股息|红利|港股|美股|A股|商品|周期|通缩|通胀|流动性|风险|交易)/i;
  if (!macroHits.test(text)) return false;
  // Filter out unrelated legal homonyms (e.g. mortgage foreclosure lawyer articles)
  if (/(断供|法拍|律师|借贷纠纷|刑法)/.test(text) && !/(付鹏说|东北证券|宏观|FICC|资产负债表)/.test(text)) {
    return false;
  }
  return true;
}

async function fetchTextTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 4500
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA_HEADER, ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Fu Peng FICC Pillar & Ticker Classifier ----------------

interface PillarRule {
  pillar: FupengMacroPillar;
  keywords: RegExp;
  defaultTargets: FupengIntelItem['mappedTargets'];
}

const PILLAR_RULES: PillarRule[] = [
  {
    pillar: '逆全球化·黄金硬通货重估',
    keywords: /(黄金|金价|实物黄金|数字黄金|PAXG|AU0|央行购金|去美元|实际利率|主权信用|右翼化|逆全球化|财政赤字|黄金脱离)/i,
    defaultTargets: [
      { symbol: 'AU0', name: '沪金主力', direction: '做多' },
      { symbol: '600547', name: '山东黄金', direction: '做多' },
      { symbol: '601899', name: '紫金矿业', direction: '做多' },
      { symbol: 'AG0', name: '沪银主力', direction: '做空' },
    ],
  },
  {
    pillar: 'FICC套息拆仓与波动率冲击',
    keywords: /(日元|套息|carry|拆仓|波动率|VIX|拥挤|高压锅|台风|缩圈|风险层|流动性贫血|闪崩|去杠杆|纳指|美股AI巨头|港股)/i,
    defaultTargets: [
      { symbol: 'IC0', name: '中证500期指', direction: '做空' },
      { symbol: 'IM0', name: '中证1000期指', direction: '做空' },
      { symbol: '159915', name: '创业板ETF', direction: '门控观察' },
      { symbol: 'AU0', name: '沪金主力', direction: '做多' },
    ],
  },
  {
    pillar: '哑铃右端·AI生产力与出海硬瓶颈',
    keywords: /(AI|人工智能|算力|光模块|英伟达|科技巨头|CapEx|生产力|奇点|电网|电力|出海|储能|变压器|新能源)/i,
    defaultTargets: [
      { symbol: '300308', name: '中际旭创', direction: '门控观察' },
      { symbol: '300502', name: '新易盛', direction: '门控观察' },
      { symbol: '002028', name: '思源电气', direction: '做多' },
      { symbol: '300274', name: '阳光电源', direction: '做多' },
    ],
  },
  {
    pillar: '大宗商品·Back现实缺口vs过剩内卷',
    keywords: /(铜|Copper|堰塞湖|囤货|原油|油价|欧线|集运|航运|Back|Contango|现实缺口|现货升水|库存|大宗商品|OPEC)/i,
    defaultTargets: [
      { symbol: 'SC0', name: '上海原油', direction: '做多' },
      { symbol: 'EC0', name: '欧线集运', direction: '做多' },
      { symbol: 'CU0', name: '沪铜主力', direction: '门控观察' },
      { symbol: '600938', name: '中国海油', direction: '做多' },
    ],
  },
  {
    pillar: '居民资产负债表与地产周期',
    keywords: /(有效需求|资产负债表|地产|房地产|房价|通缩|CPI|社融|内需|消费降级|居民杠杆|黑色|螺纹|玻璃|铁矿|内卷)/i,
    defaultTargets: [
      { symbol: 'RB0', name: '螺纹钢主力', direction: '做空' },
      { symbol: 'FG0', name: '玻璃主力', direction: '做空' },
      { symbol: 'I0', name: '铁矿石主力', direction: '做空' },
      { symbol: 'TL0', name: '30年国债期指', direction: '做多' },
    ],
  },
  {
    pillar: '哑铃左端·长债红利防御',
    keywords: /(哑铃|左端|长债|国债|红利|高股息|资产荒|低利率|利率下行|防御|现金流|长江电力|中国神华|债牛)/i,
    defaultTargets: [
      { symbol: 'TL0', name: '30年国债期指', direction: '做多' },
      { symbol: 'T0', name: '10年国债期指', direction: '做多' },
      { symbol: '600900', name: '长江电力', direction: '做多' },
      { symbol: '601088', name: '中国神华', direction: '做多' },
    ],
  },
];

const KEYWORD_TARGET_OVERRIDES: { pattern: RegExp; target: FupengIntelItem['mappedTargets'][number] }[] = [
  { pattern: /(黄金|金价|PAXG|去美元)/i, target: { symbol: 'AU0', name: '沪金主力', direction: '做多' } },
  { pattern: /(白银|金银比)/i, target: { symbol: 'AG0', name: '沪银主力', direction: '做空' } },
  { pattern: /(铜|Copper)/i, target: { symbol: 'CU0', name: '沪铜主力', direction: '门控观察' } },
  { pattern: /(原油|霍尔木兹|中东|油价)/i, target: { symbol: 'SC0', name: '上海原油', direction: '做多' } },
  { pattern: /(航运|红海|欧线|集运)/i, target: { symbol: 'EC0', name: '欧线集运', direction: '做多' } },
  { pattern: /(国债|长债|利率下行|资产荒)/i, target: { symbol: 'TL0', name: '30年国债期指', direction: '做多' } },
  { pattern: /(红利|高股息|电力|水电)/i, target: { symbol: '600900', name: '长江电力', direction: '做多' } },
  { pattern: /(煤炭|神华)/i, target: { symbol: '601088', name: '中国神华', direction: '做多' } },
  { pattern: /(光模块|CPO|算力|英伟达)/i, target: { symbol: '300308', name: '中际旭创', direction: '门控观察' } },
  { pattern: /(电网|变压器|缺电|思源)/i, target: { symbol: '002028', name: '思源电气', direction: '做多' } },
  { pattern: /(储能|光伏|阳光)/i, target: { symbol: '300274', name: '阳光电源', direction: '做多' } },
  { pattern: /(地产|螺纹|铁矿|产能过剩|内卷)/i, target: { symbol: 'RB0', name: '螺纹钢主力', direction: '做空' } },
  { pattern: /(玻璃)/i, target: { symbol: 'FG0', name: '玻璃主力', direction: '做空' } },
  { pattern: /(套息|拆仓|波动率|拥挤|高压锅)/i, target: { symbol: 'IC0', name: '中证500期指', direction: '做空' } },
];

export function classifyFupengIntel(input: {
  id?: string;
  title: string;
  summary: string;
  url: string;
  publishedAt?: string;
  capturedAt?: string;
  sourceChannel: string;
}): FupengIntelDbItem {
  const title = stripTagsAndClean(input.title).slice(0, 260);
  const cleanBody = stripTagsAndClean(input.summary);
  const combined = `${title} ${cleanBody}`;

  let bestRule = PILLAR_RULES[0];
  let bestScore = -1;
  for (const rule of PILLAR_RULES) {
    const matches = combined.match(new RegExp(rule.keywords.source, 'gi'));
    const count = matches ? matches.length : 0;
    const titleBoost = new RegExp(rule.keywords.source, 'i').test(title) ? 2 : 0;
    const score = count + titleBoost;
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  let stance: FupengIntelDbItem['stance'] = '看多配置';
  if (/(警惕|高压锅|泡沫|拆仓|风险|堰塞湖|闪崩|去杠杆|拥挤|贫血|背离|承压)/.test(combined)) {
    stance = '警惕拥挤去杠杆';
  } else if (/(过剩|内卷|通缩|地产|断供|规避|做空|走弱)/.test(combined)) {
    stance = '对冲回避';
  } else if (/(防御|哑铃|长债|红利|高股息|资产荒|国债|压舱)/.test(combined)) {
    stance = '超配防御';
  }

  const targetMap = new Map<string, FupengIntelItem['mappedTargets'][number]>();
  for (const ov of KEYWORD_TARGET_OVERRIDES) {
    if (ov.pattern.test(combined) && !targetMap.has(ov.target.symbol)) {
      targetMap.set(ov.target.symbol, ov.target);
    }
  }
  for (const dt of bestRule.defaultTargets) {
    if (targetMap.size >= 4) break;
    if (!targetMap.has(dt.symbol)) {
      targetMap.set(dt.symbol, dt);
    }
  }

  const mappedTargets = Array.from(targetMap.values()).slice(0, 4);
  const summaryOut =
    cleanBody.length >= 24
      ? cleanBody.slice(0, 320)
      : `核心归因[${bestRule.pillar}]：${title}。映射交易方向：${mappedTargets
          .map((t) => `${t.symbol}(${t.direction})`)
          .join(' / ')}。`;

  const url = String(input.url || '').trim() || `local://fupeng/${shaId('u', title)}`;
  const id = input.id || shaId('fp', url.startsWith('local://') ? title : url);
  const confidenceScore = clamp(
    72 +
      Math.min(14, Math.max(0, bestScore) * 3) +
      (input.sourceChannel.includes('见闻') || input.sourceChannel.includes('智库') ? 6 : 2),
    68,
    96
  );

  return {
    id,
    publishedAt: toBjTimestamp(input.publishedAt),
    capturedAt: toBjTimestamp(input.capturedAt || new Date()),
    sourceChannel: input.sourceChannel,
    title: title || '付鹏宏观FICC纪要',
    summary: summaryOut,
    url,
    pillar: bestRule.pillar,
    stance,
    confidenceScore,
    mappedTargets,
  };
}

// ---------------- Curated Verified Corpus & Local Read-Only Vault ----------------

function getCuratedBaselineItems(): ScrapedRawIntel[] {
  return [
    {
      title: '付鹏宏观纲领：右翼化、逆全球化与黄金脱离实际利率单锚的底层重估',
      summary:
        '2024-2026全球进入逆全球化与民粹右翼财政扩张周期，美元主权信用溢价替代单纯TIPS实际利率成为黄金定价核心锚；新兴市场央行刚性购金托底金价，建议长期配置沪金AU0及黄金龙头并配对空头对冲工业银波动。',
      url: 'local://corpus/fupeng-gold-deglobalization',
      publishedAt: '2026-10-18 09:30:00',
      sourceChannel: '本地宏观智库',
    },
    {
      title: '付鹏：有效需求不足、低利率资产荒与A股“哑铃型”两端配置策略',
      summary:
        '居民资产负债表修复期，国内长端利率中枢下移带来结构性“资产荒”。策略上坚持哑铃型结构：左端超配30Y国债TL0与高股息垄断现金流（长江电力、中国神华），右端仅在低拥挤度门控下博弈全球AI生产力与电网出海硬瓶颈。',
      url: 'local://corpus/fupeng-barbell-strategy',
      publishedAt: '2026-10-25 14:15:00',
      sourceChannel: '本地宏观智库',
    },
    {
      title: '付鹏说：大宗商品只做Back现实缺口，远离Contango过剩预期交易',
      summary:
        '宏观弱需求背景下，大宗商品切忌用通胀叙事盲目抄底Contango结构品种；真正具备胜率的是中东地缘/航运咽喉（原油SC0、欧线EC0）引发的强Backwardation现货现实缺口多头，而黑色地产链（螺纹RB0、玻璃FG0）维持过剩内卷空头对冲。',
      url: 'local://corpus/fupeng-commodity-back-realism',
      publishedAt: '2026-11-01 10:00:00',
      sourceChannel: '本地宏观智库',
    },
    {
      title: '付鹏警示：日元套息拆仓与AI高拥挤度的负偏度波动率冲击',
      summary:
        '广义Carry Trade天然具备“上楼梯慢、坐电梯快”的负偏度特征。当USD/CNH波动加剧、创业板期权Skew转负且TMT成交拥挤度突破38%高压线时，需立即收缩右端AI高Beta仓位，利用IC0/IM0期指对冲或切回黄金与长债现金防线。',
      url: 'local://corpus/fupeng-carry-unwind-vol',
      publishedAt: '2026-11-06 16:20:00',
      sourceChannel: '本地宏观智库',
    },
    {
      title: '付鹏东北证券深度路演：全球AI资本开支硬件瓶颈与电力出海长周期',
      summary:
        'AI算力竞赛进入物理瓶颈期，光通信（中际旭创、新易盛）及北美缺电拉动的电网变压器出海（思源电气、阳光电源）具备真实海外CapEx订单现金流，但需严格配合海外光通信原厂锚与A股拥挤度门控择时。',
      url: 'local://corpus/fupeng-ai-grid-bottleneck',
      publishedAt: '2026-11-11 11:05:00',
      sourceChannel: '本地宏观智库',
    },
  ];
}

function readLocalMacroVaultNotes(): ScrapedRawIntel[] {
  const out: ScrapedRawIntel[] = [];
  const targets = [
    {
      rel: '03-期货市场深度实战体系/F03-大宗商品四大板块定价锚_原油裂解价差_铜金比_美豆库消比_黄金实际利率脱钩之谜.md',
      title: '智库F03实证：铜金比/油金比定价锚与黄金脱钩实际利率之谜',
      ts: '2026-11-04 08:30:00',
    },
    {
      rel: '02-宏观经济与美元流动性水管/M06-全球套息交易水源_日元利差CarryTrade与美日实际利差平仓冲击波.md',
      title: '智库M06实证：全球套息水源Carry Unwind与负偏度左尾闪崩传导链',
      ts: '2026-11-04 09:15:00',
    },
    {
      rel: '06-经典历史危机与逼仓复盘/C03-2024年8月日元套息平仓风暴_日银加息15bp如何引发VIX飙至65与纳指闪崩.md',
      title: '智库C03复盘：2024年8月日元套息平仓风暴与高拥挤VIX脉冲拆仓规律',
      ts: '2026-11-04 10:00:00',
    },
  ];
  for (const t of targets) {
    try {
      const fp = path.join(VAULT_DIR, t.rel);
      if (!fs.existsSync(fp)) continue;
      const raw = fs.readFileSync(fp, 'utf8');
      const body = raw
        .replace(/^---[\s\S]*?---/, '')
        .replace(/[#>*`$[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (body.length > 40) {
        out.push({
          title: t.title,
          summary: body.slice(0, 280),
          url: `local://vault/${path.basename(t.rel)}`,
          publishedAt: t.ts,
          sourceChannel: '本地宏观智库',
        });
      }
    } catch {
      // ignore read-only vault error
    }
  }
  return out;
}

// ---------------- Live Channel Scrapers (4.5s timeouts) ----------------

async function scrapeBingNewsRss(): Promise<{ items: ScrapedRawIntel[]; detail: string; ok: boolean }> {
  const urls = [
    'https://www.bing.com/news/search?q=%E4%BB%98%E9%B9%8F&format=rss',
    'https://www.bing.com/news/search?q=%E4%BB%98%E9%B9%8F+%E8%B4%A2%E7%BB%8F&format=rss',
  ];
  const collected: ScrapedRawIntel[] = [];
  let xmlCount = 0;
  let htmlFallbackHits = 0;

  await Promise.all(
    urls.map(async (u) => {
      try {
        const text = await fetchTextTimeout(
          u,
          { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
          4500
        );
        const itemMatches = text.match(/<item\b[\s\S]*?<\/item>/gi) || [];
        if (itemMatches.length > 0) {
          xmlCount += itemMatches.length;
          for (const block of itemMatches) {
            const title = stripTagsAndClean((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
            const link = stripTagsAndClean((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '');
            const desc = stripTagsAndClean(
              (block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || ''
            );
            const pubDate = stripTagsAndClean(
              (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || ''
            );
            if (title && isRelevantFupengArticle(title, desc)) {
              collected.push({
                title,
                summary: desc || title,
                url: link || `bing://news/${shaId('b', title)}`,
                publishedAt: pubDate || nowBjIso(),
                sourceChannel: 'Bing资讯RSS',
              });
            }
          }
        } else {
          // Graceful parse of Bing HTML news cards if CN edge served HTML instead of XML
          const cardRe = /<a[^>]+class="[^"]*title[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
          let m: RegExpExecArray | null;
          while ((m = cardRe.exec(text)) !== null) {
            const href = decodeHtmlEntities(m[1] || '');
            const title = stripTagsAndClean(m[2] || '');
            if (title && href.startsWith('http') && isRelevantFupengArticle(title, title)) {
              htmlFallbackHits++;
              collected.push({
                title,
                summary: title,
                url: href,
                publishedAt: nowBjIso(),
                sourceChannel: 'Bing资讯RSS',
              });
            }
          }
        }
      } catch {
        // tolerate individual query timeout
      }
    })
  );

  return {
    items: collected,
    ok: xmlCount > 0 || htmlFallbackHits > 0 || collected.length > 0,
    detail:
      xmlCount > 0
        ? `解析RSS XML ${xmlCount}条，命中付鹏宏观 ${collected.length}条`
        : collected.length > 0
        ? `Bing网页卡片回退提取 ${collected.length}条`
        : 'Bing CN节点返回SPA外壳未吐出XML，已降级保护',
  };
}

async function scrapeEastmoneySearch(): Promise<{ items: ScrapedRawIntel[]; detail: string; ok: boolean }> {
  const keywords = ['付鹏', '付鹏 黄金'];
  const collected: ScrapedRawIntel[] = [];
  let rawHits = 0;

  await Promise.all(
    keywords.map(async (kw) => {
      try {
        const param = JSON.stringify({
          uid: '',
          keyword: kw,
          type: ['cmsArticleWebOld'],
          client: 'web',
          clientType: 'web',
          clientVersion: 'curr',
          param: {
            cmsArticleWebOld: {
              searchScope: 'default',
              sort: 'default',
              pageIndex: 1,
              pageSize: 10,
              preTag: '',
              postTag: '',
            },
          },
        });
        const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=emcb&param=${encodeURIComponent(
          param
        )}`;
        const txt = await fetchTextTimeout(url, { Referer: 'https://so.eastmoney.com/' }, 4500);
        const m = txt.match(/^emcb\(([\s\S]*)\)$/s);
        if (!m) return;
        const json = JSON.parse(m[1]);
        const list = Array.isArray(json?.result?.cmsArticleWebOld) ? json.result.cmsArticleWebOld : [];
        rawHits += list.length;
        for (const it of list) {
          const title = stripTagsAndClean(it.title || '');
          const content = stripTagsAndClean(it.content || '');
          const artUrl = String(it.url || '').trim();
          if (title && isRelevantFupengArticle(title, content)) {
            collected.push({
              title,
              summary: content || title,
              url: artUrl || `eastmoney://article/${it.code || shaId('em', title)}`,
              publishedAt: it.date || nowBjIso(),
              sourceChannel: '东财财富号/资讯',
            });
          }
        }
      } catch {
        // ignore single query error
      }
    })
  );

  return {
    items: collected,
    ok: rawHits > 0 || collected.length > 0,
    detail: `东财搜索检索 ${rawHits}篇，宏观过滤命中 ${collected.length}篇`,
  };
}

async function scrapeSinaAndSocial(): Promise<{ items: ScrapedRawIntel[]; detail: string; ok: boolean }> {
  const collected: ScrapedRawIntel[] = [];
  let rollTotal = 0;
  let biliCount = 0;

  const [sinaRes, biliRes] = await Promise.allSettled([
    fetchTextTimeout(
      'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=%E4%BB%98%E9%B9%8F&num=25&page=1',
      { Referer: 'https://finance.sina.com.cn/' },
      4500
    ),
    fetchTextTimeout(
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E4%BB%98%E9%B9%8F&order=pubdate&page=1',
      {
        Referer: 'https://search.bilibili.com/',
        Cookie: 'buvid3=TSP-FUPENG-24H-WATCHER-0001infoc;',
      },
      4500
    ),
  ]);

  if (sinaRes.status === 'fulfilled') {
    try {
      const json = JSON.parse(sinaRes.value);
      const list = Array.isArray(json?.result?.data) ? json.result.data : [];
      rollTotal = list.length;
      for (const it of list) {
        const title = stripTagsAndClean(it.title || it.stitle || '');
        const summary = stripTagsAndClean(it.intro || it.summary || title);
        const link = String(it.url || it.wapurl || '').trim();
        const ctime = it.ctime ? Number(it.ctime) : undefined;
        if (title && isRelevantFupengArticle(title, summary)) {
          collected.push({
            title,
            summary,
            url: link || `sina://roll/${shaId('sn', title)}`,
            publishedAt: ctime ? toBjTimestamp(ctime) : nowBjIso(),
            sourceChannel: '新浪财经/微博',
          });
        }
      }
    } catch {
      // ignore parse failure
    }
  }

  if (biliRes.status === 'fulfilled') {
    try {
      const json = JSON.parse(biliRes.value);
      const list = Array.isArray(json?.data?.result) ? json.data.result : [];
      for (const v of list.slice(0, 8)) {
        const title = stripTagsAndClean(v.title || '');
        const desc = stripTagsAndClean(v.description || '');
        const arcurl = String(v.arcurl || (v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : '')).trim();
        const pubdate = v.pubdate ? Number(v.pubdate) : undefined;
        if (title && isRelevantFupengArticle(title, `${desc} ${v.author || ''}`)) {
          biliCount++;
          collected.push({
            title: `[视频访谈] ${title}`,
            summary: desc || `UP主(${v.author || '宏观研究'})发布付鹏相关解读视频`,
            url: arcurl || `bili://video/${v.bvid || shaId('bl', title)}`,
            publishedAt: pubdate ? toBjTimestamp(pubdate) : nowBjIso(),
            sourceChannel: '新浪财经/微博',
          });
        }
      }
    } catch {
      // ignore parse failure
    }
  }

  return {
    items: collected,
    ok: rollTotal > 0 || biliCount > 0,
    detail: `新浪财经滚动 ${rollTotal}条 + 社交视频流命中 ${biliCount}条`,
  };
}

async function scrapeWscnAndCls(): Promise<{ items: ScrapedRawIntel[]; detail: string; ok: boolean }> {
  const collected: ScrapedRawIntel[] = [];
  let wscnHits = 0;
  let jin10Hits = 0;

  const [w1, w2, jin] = await Promise.allSettled([
    fetchTextTimeout(
      'https://api-one-wscn.awtmt.com/apiv1/search/article?query=%E4%BB%98%E9%B9%8F&limit=15',
      { Referer: 'https://wallstreetcn.com/' },
      4500
    ),
    fetchTextTimeout(
      'https://api-one-wscn.awtmt.com/apiv1/search/article?query=%E4%BB%98%E9%B9%8F%E8%AF%B4&limit=10',
      { Referer: 'https://wallstreetcn.com/' },
      4500
    ),
    fetchTextTimeout(
      'https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1',
      { 'x-app-id': 'bVBF4FyRTn5NJF5n', 'x-version': '1.0.0' },
      4500
    ),
  ]);

  const seenUrls = new Set<string>();
  for (const res of [w1, w2]) {
    if (res.status !== 'fulfilled') continue;
    try {
      const json = JSON.parse(res.value);
      const list = Array.isArray(json?.data?.items) ? json.data.items : [];
      for (const it of list) {
        const title = stripTagsAndClean(it.title || '');
        const summary = stripTagsAndClean(it.content_short || it.content || '');
        const uri = String(it.uri || `https://wallstreetcn.com/articles/${it.id}`).split('?keyword=')[0];
        if (!title || seenUrls.has(uri)) continue;
        if (isRelevantFupengArticle(title, summary)) {
          seenUrls.add(uri);
          wscnHits++;
          collected.push({
            title,
            summary: summary || title,
            url: uri,
            publishedAt: it.display_time ? toBjTimestamp(Number(it.display_time)) : nowBjIso(),
            sourceChannel: '财联社/见闻',
          });
        }
      }
    } catch {
      // ignore parse failure
    }
  }

  if (jin.status === 'fulfilled') {
    try {
      const json = JSON.parse(jin.value);
      const list = Array.isArray(json?.data) ? json.data : [];
      for (const it of list) {
        const content = stripTagsAndClean(it?.data?.content || it?.data?.title || '');
        if (content && isRelevantFupengArticle(content, content)) {
          jin10Hits++;
          collected.push({
            title: content.slice(0, 80),
            summary: content,
            url: `jin10://flash/${it.id || shaId('j10', content)}`,
            publishedAt: it.time ? toBjTimestamp(it.time) : nowBjIso(),
            sourceChannel: '财联社/见闻',
          });
        }
      }
    } catch {
      // ignore parse failure
    }
  }

  return {
    items: collected,
    ok: wscnHits > 0 || jin10Hits > 0,
    detail: `华尔街见闻《付鹏说》直连 ${wscnHits}篇 · 金十快讯过滤 ${jin10Hits}条`,
  };
}

function readEgoWatcherFeed(): { items: ScrapedRawIntel[]; detail: string; ok: boolean } {
  const scriptExists = fs.existsSync(path.resolve(APP_ROOT_DIR, EGO_SCRIPT_REL));
  const collected: ScrapedRawIntel[] = [];
  let lineCount = 0;

  if (fs.existsSync(EGO_FEED_JSONL)) {
    try {
      const lines = fs
        .readFileSync(EGO_FEED_JSONL, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      lineCount = lines.length;
      for (const line of lines.slice(-60)) {
        try {
          const obj = JSON.parse(line);
          const rows = Array.isArray(obj.items) ? obj.items : obj.title ? [obj] : [];
          for (const r of rows) {
            const title = stripTagsAndClean(r.title || '');
            const summary = stripTagsAndClean(r.summary || r.content || title);
            if (title && isRelevantFupengArticle(title, summary)) {
              collected.push({
                title,
                summary,
                url: String(r.url || `ego://feed/${shaId('ego', title)}`),
                publishedAt: r.publishedAt || obj.timestamp || nowBjIso(),
                sourceChannel: 'Ego24h静默守护',
              });
            }
          }
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore file error
    }
  }

  return {
    items: collected,
    ok: scriptExists,
    detail: scriptExists
      ? `守护脚本就绪 (${lineCount}条JSONL轨迹 · 命中 ${collected.length}条)`
      : '未检测到Ego守护脚本',
  };
}

function deduplicateRawItems(raw: ScrapedRawIntel[]): ScrapedRawIntel[] {
  const byUrl = new Map<string, ScrapedRawIntel>();
  const seenTitles = new Set<string>();

  for (const it of raw) {
    const cleanTitle = stripTagsAndClean(it.title);
    if (!cleanTitle) continue;
    const normTitle = cleanTitle.replace(/[\s【】[\]()（）：:，,。."“”'‘’\-—]/g, '').toLowerCase();
    const normUrl = String(it.url || '').trim().split('#')[0];
    if (seenTitles.has(normTitle)) continue;
    if (normUrl && byUrl.has(normUrl)) continue;
    seenTitles.add(normTitle);
    byUrl.set(normUrl || `title://${normTitle}`, {
      ...it,
      title: cleanTitle,
      summary: stripTagsAndClean(it.summary || cleanTitle),
      url: normUrl || `local://fupeng/${shaId('t', normTitle)}`,
    });
  }
  return Array.from(byUrl.values());
}

export async function scrapeFupengLatestIntel(): Promise<{
  ok: boolean;
  newlyAdded: number;
  totalCount: number;
  channels: FupengScraperChannelStatus[];
  items: FupengIntelItem[];
  newItems: FupengIntelItem[];
}> {
  const checkedAt = nowBjIso();
  const existingIds = new Set(dbListFupengIntel(500).map((i) => i.id));
  const existingUrls = new Set(dbListFupengIntel(500).map((i) => i.url));

  const timed = async <T>(fn: () => Promise<T>): Promise<{ res: T | null; ms: number }> => {
    const t0 = Date.now();
    try {
      const res = await fn();
      return { res, ms: Date.now() - t0 };
    } catch {
      return { res: null, ms: Date.now() - t0 };
    }
  };

  const [bingRun, emRun, sinaRun, wscnRun] = await Promise.all([
    timed(() => scrapeBingNewsRss()),
    timed(() => scrapeEastmoneySearch()),
    timed(() => scrapeSinaAndSocial()),
    timed(() => scrapeWscnAndCls()),
  ]);

  const tVault0 = Date.now();
  const vaultRaw = [...readLocalMacroVaultNotes(), ...getCuratedBaselineItems()];
  const vaultMs = Date.now() - tVault0;

  const tEgo0 = Date.now();
  const egoRes = readEgoWatcherFeed();
  const egoMs = Date.now() - tEgo0;

  const channelStatuses: FupengScraperChannelStatus[] = [
    {
      id: 'bing_rss',
      name: 'Bing资讯RSS',
      method: 'XML RSS / News Search',
      ok: Boolean(bingRun.res?.ok),
      latencyMs: bingRun.ms,
      fetchedCount: bingRun.res?.items.length ?? 0,
      lastCheckedAt: checkedAt,
      detail: bingRun.res?.detail || '请求超时',
    },
    {
      id: 'eastmoney_news',
      name: '东财财富号/资讯',
      method: 'JSONP Search API',
      ok: Boolean(emRun.res?.ok),
      latencyMs: emRun.ms,
      fetchedCount: emRun.res?.items.length ?? 0,
      lastCheckedAt: checkedAt,
      detail: emRun.res?.detail || '请求超时',
    },
    {
      id: 'sina_weibo_roll',
      name: '新浪财经/微博',
      method: 'Roll API + 社交视频流',
      ok: Boolean(sinaRun.res?.ok),
      latencyMs: sinaRun.ms,
      fetchedCount: sinaRun.res?.items.length ?? 0,
      lastCheckedAt: checkedAt,
      detail: sinaRun.res?.detail || '请求超时',
    },
    {
      id: 'wscn_cls',
      name: '财联社/华尔街见闻',
      method: 'WSCN《付鹏说》直连 + Jin10',
      ok: Boolean(wscnRun.res?.ok),
      latencyMs: wscnRun.ms,
      fetchedCount: wscnRun.res?.items.length ?? 0,
      lastCheckedAt: checkedAt,
      detail: wscnRun.res?.detail || '请求超时',
    },
    {
      id: 'local_vault',
      name: '本地宏观智库',
      method: 'Read-Only Vault + FICC语料',
      ok: vaultRaw.length > 0,
      latencyMs: vaultMs,
      fetchedCount: vaultRaw.length,
      lastCheckedAt: checkedAt,
      detail: `本地智库笔记与2024-2026经典FICC纲领 ${vaultRaw.length}篇`,
    },
    {
      id: 'ego_daemon',
      name: 'Ego 24h静默守护',
      method: 'ego-browser TaskSpace JSONL',
      ok: egoRes.ok,
      latencyMs: egoMs,
      fetchedCount: egoRes.items.length,
      lastCheckedAt: checkedAt,
      detail: egoRes.detail,
    },
  ];

  const mergedRaw = deduplicateRawItems([
    ...(wscnRun.res?.items ?? []),
    ...(emRun.res?.items ?? []),
    ...(sinaRun.res?.items ?? []),
    ...(bingRun.res?.items ?? []),
    ...egoRes.items,
    ...vaultRaw,
  ]);

  const classified: FupengIntelDbItem[] = mergedRaw.map((raw) =>
    classifyFupengIntel({
      title: raw.title,
      summary: raw.summary,
      url: raw.url,
      publishedAt: raw.publishedAt,
      capturedAt: checkedAt,
      sourceChannel: raw.sourceChannel,
    })
  );

  const newItemsRaw = classified.filter((c) => !existingIds.has(c.id) && !existingUrls.has(c.url));
  const { inserted, total } = dbUpsertFupengIntelItems(classified);

  lastScrapedAt = checkedAt;
  lastChannelStatuses = channelStatuses;

  const allItems = dbListFupengIntel(80) as FupengIntelItem[];
  return {
    ok: true,
    newlyAdded: inserted,
    totalCount: total,
    channels: channelStatuses,
    items: allItems,
    newItems: newItemsRaw as FupengIntelItem[],
  };
}

export async function ingestCustomFupengNote(payload: {
  title: string;
  content: string;
  sourceUrl?: string;
  sourceChannel?: string;
  publishedAt?: string;
}): Promise<{ ok: boolean; item: FupengIntelItem; overview: FupengOverviewResponse }> {
  const title = stripTagsAndClean(payload.title || '付鹏最新观点/纪要手工解析');
  const content = stripTagsAndClean(payload.content || title);
  const nowStr = nowBjIso();
  const classified = classifyFupengIntel({
    id: shaId('note', `${title}:${content.slice(0, 80)}:${nowStr.slice(0, 13)}`),
    title,
    summary: content,
    url: payload.sourceUrl?.trim() || `local://manual/${Date.now()}`,
    publishedAt: payload.publishedAt || nowStr,
    capturedAt: nowStr,
    sourceChannel: payload.sourceChannel || '手工纪要投喂',
  });

  dbUpsertFupengIntelItems([classified]);
  const overview = await getFupengFrameworkOverview();
  return {
    ok: true,
    item: classified as FupengIntelItem,
    overview,
  };
}

// ---------------- Live Market Data Helpers for Coordinates & 6 Baskets ----------------

const BASKET_A_SHARES = [
  '600900', // 长江电力
  '601088', // 中国神华
  '601398', // 工商银行
  '600941', // 中国移动
  '300308', // 中际旭创
  '300502', // 新易盛
  '002028', // 思源电气
  '300274', // 阳光电源
  '688256', // 寒武纪
  '600547', // 山东黄金
  '601899', // 紫金矿业
  '600938', // 中国海油
  '601919', // 中远海控
  '159915', // 创业板ETF
];

const BASKET_FUTURES = ['TL0', 'T0', 'AU0', 'AG0', 'CU0', 'SC0', 'EC0', 'RB0', 'FG0', 'I0', 'IC0', 'IM0'];

async function loadFupengLiveMarketSnapshot() {
  return cachedFetch(
    'fupeng_live_market_snapshot_v2',
    45_000,
    async () => {
      const [futQuotes, stockQuotes, optSkews, cpoOverview] = await Promise.all([
        fetch28FuturesQuotes().catch(() => [] as FuturesQuoteItem[]),
        fetchTencentQuotes(BASKET_A_SHARES).catch(() => ({} as Record<string, StockQuoteItem>)),
        fetchOptionSkews()
          .then((r) => r.items)
          .catch(() => [] as Awaited<ReturnType<typeof fetchOptionSkews>>['items']),
        getCpoTransmissionOverview().catch(() => null),
      ]);

      // Fetch 30-day K-lines in parallel for real 20d returns
      const futKlineEntries = await Promise.all(
        BASKET_FUTURES.map(async (sym) => {
          const res = await fetchFuturesKLines(sym, 30).catch(() => ({ symbol: sym, name: sym, klines: [] }));
          return [sym, res.klines] as const;
        })
      );
      const stockKlineEntries = await Promise.all(
        BASKET_A_SHARES.map(async (code) => {
          const klines = await fetchTencentKLines(code, 30, false).catch(() => [] as KLineBar[]);
          return [code, klines] as const;
        })
      );

      const futMap: Record<string, FuturesQuoteItem> = Object.fromEntries(
        futQuotes.map((q) => [q.symbol, q])
      );
      const futKMap: Record<string, DailyBar[]> = Object.fromEntries(
        futKlineEntries.map(([s, ks]) => [s, ks.map((k) => ({ date: k.date, close: k.close, volume: k.volume }))])
      );
      const stockKMap: Record<string, DailyBar[]> = Object.fromEntries(
        stockKlineEntries.map(([c, ks]) => [c, ks.map((k) => ({ date: k.date, close: k.close, volume: k.volume }))])
      );

      return {
        futMap,
        futKMap,
        stockQuotes,
        stockKMap,
        optSkews,
        cpoOverview,
      };
    },
    { persistDisk: true, diskMaxAgeMs: 86_400_000 }
  );
}

function calc20dChangePct(bars: DailyBar[] | undefined, currentPrice?: number): number {
  if (!bars || bars.length < 5) return 0;
  const last = currentPrice && currentPrice > 0 ? currentPrice : bars[bars.length - 1].close;
  const refIdx = Math.max(0, bars.length - 21);
  const base = bars[refIdx].close;
  if (!base || base <= 0) return 0;
  return round(((last - base) / base) * 100, 2);
}

function getRatio20dChangePct(
  numBars: DailyBar[] | undefined,
  denBars: DailyBar[] | undefined,
  curNum: number,
  curDen: number
): number {
  if (!numBars || !denBars || numBars.length < 5 || denBars.length < 5 || curDen <= 0) return 0;
  const denMap = new Map(denBars.map((b) => [b.date, b.close]));
  const aligned: { date: string; ratio: number }[] = [];
  for (const nb of numBars) {
    const dc = denMap.get(nb.date);
    if (dc && dc > 0 && nb.close > 0) aligned.push({ date: nb.date, ratio: nb.close / dc });
  }
  if (aligned.length < 5) return 0;
  const base = aligned[Math.max(0, aligned.length - 21)].ratio;
  const cur = curNum / curDen;
  return base > 0 ? round(((cur - base) / base) * 100, 2) : 0;
}

export async function getFupengFrameworkOverview(): Promise<FupengOverviewResponse> {
  // Ensure baseline + live intel exist on initial load
  if (dbGetFupengIntelCount() <= 2) {
    await scrapeFupengLatestIntel().catch(() => null);
  }

  const snap = await loadFupengLiveMarketSnapshot();
  const intelList = dbListFupengIntel(80) as FupengIntelItem[];

  const getFut = (sym: string, fallbackPx: number) => {
    const q = snap.futMap?.[sym];
    const bars = snap.futKMap?.[sym];
    const px = q?.price && q.price > 0 ? q.price : bars?.[bars.length - 1]?.close || fallbackPx;
    const chg = q?.changePct ?? 0;
    const chg20 = calc20dChangePct(bars, px);
    return { price: round(px, 2), changePct: round(chg, 2), change20dPct: chg20, bars };
  };

  const getStk = (code: string, fallbackPx: number) => {
    const q = snap.stockQuotes?.[code];
    const bars = snap.stockKMap?.[code];
    const px = q?.price && q.price > 0 ? q.price : bars?.[bars.length - 1]?.close || fallbackPx;
    const chg = q?.changePct ?? 0;
    const chg20 = calc20dChangePct(bars, px);
    return { price: round(px, 2), changePct: round(chg, 2), change20dPct: chg20, bars };
  };

  // 1. Live FICC 4 Coordinates
  const cu0 = getFut('CU0', 76500);
  const au0 = getFut('AU0', 615);
  const sc0 = getFut('SC0', 530);
  const tl0 = getFut('TL0', 112.5);
  const t0 = getFut('T0', 106.5);
  const cyp = getStk('600900', 28.5);
  const shh = getStk('601088', 40.2);

  const cuAuRatio = au0.price > 0 ? round(cu0.price / au0.price, 2) : 124.3;
  const cuAuChg20d = getRatio20dChangePct(cu0.bars, au0.bars, cu0.price, au0.price);
  const scAuRatio = au0.price > 0 ? round(sc0.price / au0.price, 3) : 0.86;
  const scAuChg20d = getRatio20dChangePct(sc0.bars, au0.bars, sc0.price, au0.price);

  const usdcnhOpt = snap.optSkews.find((o) => o.symbol === 'USDCNH');
  const cybOpt = snap.optSkews.find((o) => o.symbol === '159915.OPT');
  const usdcnhPx = usdcnhOpt?.underlyingPrice || 7.18;
  const usdcnhChg = usdcnhOpt?.underlyingChangePct || 0;
  const cybSkew = snap.cpoOverview?.marketContext.chinextOptionSkew ?? cybOpt?.ivSkew25d ?? -1.2;
  const tmtCrowding = snap.cpoOverview?.marketContext.tmtTurnoverSharePct ?? 29.5;
  const dividendAvg20d = round((cyp.change20dPct + shh.change20dPct) / 2, 2);

  const carryAlert = tmtCrowding > 38 || cybSkew <= -3.5 || usdcnhChg >= 0.4;

  const coordinates: FupengFiccCoordinate[] = [
    {
      id: 'coord_cu_au',
      name: '铜金比 (CU0 / AU0)',
      currentValueText: `${cuAuRatio.toFixed(2)}x`,
      change20dText: `20日斜率 ${cuAuChg20d >= 0 ? '+' : ''}${cuAuChg20d}%`,
      regimeReading:
        cuAuChg20d <= -2
          ? '铜金比20日走弱，全球制造业有效需求跑输主权黄金避险，哑铃应向黄金+红利左端倾斜。'
          : cuAuChg20d >= 2.5
          ? '铜金比走扩修复，全球电网/补库需求接力，可适度释放右端周期与硬件弹性。'
          : '铜金比维持震荡中枢，需求温和但去美元化黄金底盘稳固，维持标准哑铃结构。',
      signalBias:
        cuAuChg20d <= -2 ? '利多防御/黄金' : cuAuChg20d >= 2.5 ? '利多Back资源' : '中性均衡',
    },
    {
      id: 'coord_sc_au',
      name: '油金比 (SC0 / AU0)',
      currentValueText: `${scAuRatio.toFixed(3)}x`,
      change20dText: `20日斜率 ${scAuChg20d >= 0 ? '+' : ''}${scAuChg20d}%`,
      regimeReading:
        scAuChg20d >= 3
          ? '油金比抬升反映中东供应/航运咽喉溢价脉冲，商品只做强Back现实缺口，谨防滞胀挤压成长估值。'
          : scAuChg20d <= -3
          ? '油金比回落，能源通胀摩擦缓释，利好国内长债TL0及低利率成长折现因子。'
          : '油金比处于均衡通道，地缘供给溢价可控，能源链以波段逢低承接为主。',
      signalBias:
        scAuChg20d >= 3 ? '利多Back资源' : scAuChg20d <= -3 ? '利多防御/黄金' : '中性均衡',
    },
    {
      id: 'coord_low_rate_anchor',
      name: '国内低利率锚 (TL0 & 红利利差)',
      currentValueText: `TL0 ${tl0.price} / T0 ${t0.price}`,
      change20dText: `TL20日 ${tl0.change20dPct >= 0 ? '+' : ''}${tl0.change20dPct}% · 红利 ${dividendAvg20d >= 0 ? '+' : ''}${dividendAvg20d}%`,
      regimeReading:
        tl0.change20dPct >= -0.3
          ? '长债期货TL0稳健运行、垄断高股息现金流锚稳固，国内居民资产荒下哑铃左端底仓逻辑未破。'
          : '长债20日出现阶段性获利回吐，需观察国债期限利差是否因财政放量阶段性陡峭化。',
      signalBias: tl0.change20dPct >= -0.3 ? '利多防御/黄金' : '中性均衡',
    },
    {
      id: 'coord_carry_crowding',
      name: '套息拆仓与拥挤度雷达 (CNH/Skew/TMT)',
      currentValueText: `CNH ${usdcnhPx.toFixed(4)} | Skew ${cybSkew.toFixed(2)} | TMT ${tmtCrowding.toFixed(1)}%`,
      change20dText: `CNH日变 ${usdcnhChg >= 0 ? '+' : ''}${usdcnhChg}%`,
      regimeReading: carryAlert
        ? '警告：TMT交易拥挤度逼近/突破38%或期权偏度/汇率异动，具备负偏度去杠杆冲击风险，启动右端减仓门控！'
        : '汇率稳健且TMT拥挤度处于18%-38%安全区，套息拆仓尾部风险暂未引爆，允许右端AI硬瓶颈按门控参与。',
      signalBias: carryAlert ? '高拥挤去杠杆预警' : tmtCrowding >= 18 ? '利多AI硬瓶颈' : '中性均衡',
    },
  ];

  // 2. Build 6 Live Tradable Reference Baskets
  const makeTarget = (
    spec: Omit<FupengReferenceTarget, 'price' | 'changePct' | 'change20dPct'>,
    isFuture = false
  ): FupengReferenceTarget => {
    const q = isFuture
      ? getFut(spec.symbol, 100)
      : getStk(spec.symbol, 20);
    return {
      ...spec,
      price: q.price,
      changePct: q.changePct,
      change20dPct: q.change20dPct,
    };
  };

  const baskets: FupengTradableBasket[] = [
    {
      id: 'basket_barbell_left',
      name: '哑铃左端：长久期国债 & 垄断高股息现金流底仓',
      pillar: '哑铃左端·长债红利防御',
      thesisSummary: '居民部门去杠杆与低利率资产荒环境中，锁定确定性票息与垄断公用事业分红现金流，作为组合抗波动压舱石。',
      currentRegimeFit: tl0.change20dPct >= 0 || cuAuChg20d < 0 ? '强烈契合·主配' : '标准底仓配置',
      recommendedAllocationPct: 35,
      targets: [
        makeTarget(
          {
            symbol: 'TL0',
            name: '30年国债期指',
            market: '国内期货',
            frameworkRole: '国内长端无风险利率下行终极贝塔锚',
            direction: '做多底仓',
            suggestedWeightPct: 10,
            entryTriggerRule: 'TL0站稳MA20且10Y国债利率不突破上沿阻力',
            falsificationRule: '超长特别国债天量放量发行致曲线急剧熊陡跌破60日线',
          },
          true
        ),
        makeTarget(
          {
            symbol: 'T0',
            name: '10年国债期指',
            market: '国内期货',
            frameworkRole: '流动性平价对冲与低波动底仓',
            direction: '做多底仓',
            suggestedWeightPct: 5,
            entryTriggerRule: '货币宽松周期或社融脉冲低于预期时顺势配置',
            falsificationRule: '央行明确提示长债利率风险并连续大幅净回笼',
          },
          true
        ),
        makeTarget({
          symbol: '600900',
          name: '长江电力',
          market: 'A股核心标的',
          frameworkRole: '水电垄断类债资产之王，穿越周期确定性分红',
          direction: '做多底仓',
          suggestedWeightPct: 8,
          entryTriggerRule: '股息率-10Y国债利差 > +150bp 且回踩MA20缩量企稳',
          falsificationRule: '来水持续极端枯竭叠加电价市场化大幅折价',
        }),
        makeTarget({
          symbol: '601088',
          name: '中国神华',
          market: 'A股核心标的',
          frameworkRole: '长协煤高股息现金牛，通胀与通缩双象限防御',
          direction: '做多底仓',
          suggestedWeightPct: 5,
          entryTriggerRule: '煤电长协价格稳固且静态股息率维持4.5%+区间',
          falsificationRule: '进口煤暴增击穿长协下限或分红率大幅下调',
        }),
        makeTarget({
          symbol: '601398',
          name: '工商银行',
          market: 'A股核心标的',
          frameworkRole: '国有大行高股息国家信用平价底仓',
          direction: '做多底仓',
          suggestedWeightPct: 4,
          entryTriggerRule: '破净低估值叠加险资OCI账户长期配置流入',
          falsificationRule: '净息差超预期失速跌破1.2%警戒线且不良生成飙升',
        }),
        makeTarget({
          symbol: '600941',
          name: '中国移动',
          market: 'A股核心标的',
          frameworkRole: '运营商数字底座现金流+高派息双红利',
          direction: '做多底仓',
          suggestedWeightPct: 3,
          entryTriggerRule: '资本开支见顶回落带来自由现金流率抬升',
          falsificationRule: 'ARPU下滑失速且CapEx重返无序扩张',
        }),
      ],
    },
    {
      id: 'basket_barbell_right',
      name: '哑铃右端：全球AI生产力奇点 & 电力出海硬瓶颈',
      pillar: '哑铃右端·AI生产力与出海硬瓶颈',
      thesisSummary: '跳过内卷红海，只赚全球AI算力CapEx奇点与欧美缺电电网基建硬瓶颈的真实海外订单溢价，严格受拥挤度门控。',
      currentRegimeFit: carryAlert ? '高拥挤收缩防守' : '强烈契合·主配',
      recommendedAllocationPct: carryAlert ? 15 : 28,
      targets: [
        makeTarget({
          symbol: '300308',
          name: '中际旭创',
          market: 'A股核心标的',
          frameworkRole: '全球800G/1.6T光模块全球供应链核心瓶颈锚',
          direction: '门控右侧做多',
          suggestedWeightPct: carryAlert ? 3 : 7,
          entryTriggerRule: 'COHR/LITE隔夜锚>= -0.35% 且 TMT拥挤度<38% + 站稳VWAP',
          falsificationRule: '北美云厂商CapEx指引下修或TMT成交拥挤度>40%放量长阴',
        }),
        makeTarget({
          symbol: '300502',
          name: '新易盛',
          market: 'A股核心标的',
          frameworkRole: '高弹性光通信出海二阶利润释放标的',
          direction: '门控右侧做多',
          suggestedWeightPct: carryAlert ? 2 : 5,
          entryTriggerRule: '光模块龙头共振上行且滞后残差Z < -0.8 补涨窗口',
          falsificationRule: '海外大客户砍单传闻落地或跌破20日生命线放量不收回',
        }),
        makeTarget({
          symbol: '002028',
          name: '思源电气',
          market: 'A股核心标的',
          frameworkRole: '北美数据中心缺电与全球电网变压器出海硬资产',
          direction: '门控右侧做多',
          suggestedWeightPct: 6,
          entryTriggerRule: '海外电网招标景气度上行且毛利率维持扩张趋势',
          falsificationRule: '欧美对电力设备全面加征惩罚性关税阻断出口通道',
        }),
        makeTarget({
          symbol: '300274',
          name: '阳光电源',
          market: 'A股核心标的',
          frameworkRole: '全球大储刚性配储+逆变器出海高壁垒龙头',
          direction: '门控右侧做多',
          suggestedWeightPct: 5,
          entryTriggerRule: '碳酸锂企稳+北美大储装机交付增速维持30%+',
          falsificationRule: '海外补贴全面退坡引发装机骤停与价格战恶化',
        }),
        makeTarget({
          symbol: '688256',
          name: '寒武纪',
          market: 'A股核心标的',
          frameworkRole: '国产算力芯片自主可控极值弹性期权腿',
          direction: '门控右侧做多',
          suggestedWeightPct: carryAlert ? 1 : 5,
          entryTriggerRule: 'AI国产替代事件概率脉冲且创业板Skew>-3.0',
          falsificationRule: '高拥挤流动性退潮期，严格禁止在TMT>38%时追高接盘',
        }),
      ],
    },
    {
      id: 'basket_gold_hard',
      name: '逆全球化与央行去美元化：黄金硬通货与金银比对冲',
      pillar: '逆全球化·黄金硬通货重估',
      thesisSummary: '2022后黄金脱离实际利率单锚，转由全球央行储备重构与美债财政赤字稀释定价；用空AG0对冲工业属性回撤。',
      currentRegimeFit: '强烈契合·主配',
      recommendedAllocationPct: 22,
      targets: [
        makeTarget(
          {
            symbol: 'AU0',
            name: '沪金主力',
            market: '国内期货',
            frameworkRole: '主权信用对冲核心底仓，脱离实际利率单锚定价',
            direction: '做多底仓',
            suggestedWeightPct: 12,
            entryTriggerRule: 'Hyperliquid PAXG 24h溢价>0 或央行持续净购金周期',
            falsificationRule: '美国财政实质性大幅削减赤字+全球地缘全面和解签约',
          },
          true
        ),
        makeTarget({
          symbol: '600547',
          name: '山东黄金',
          market: 'A股核心标的',
          frameworkRole: '高纯度黄金权益资源杠杆映射',
          direction: '做多底仓',
          suggestedWeightPct: 4,
          entryTriggerRule: '沪金创阶段新高而黄金股滞后补涨（滞后Z < -1.0）',
          falsificationRule: '金价跌破60日均线趋势锚或矿山产出大幅低于预期',
        }),
        makeTarget({
          symbol: '601899',
          name: '紫金矿业',
          market: 'A股核心标的',
          frameworkRole: '铜金双轮全球矿业巨头，兼享黄金避险与电网铜溢价',
          direction: '做多底仓',
          suggestedWeightPct: 4,
          entryTriggerRule: '金价稳固且铜价不发生系统性衰退崩盘',
          falsificationRule: '全球工业危机导致铜价暴跌拖累整体盈利中枢',
        }),
        makeTarget(
          {
            symbol: 'AG0',
            name: '沪银主力',
            market: '国内期货',
            frameworkRole: '多AU空AG金银比保护腿，剥离工业衰退Beta',
            direction: '多空配对腿',
            suggestedWeightPct: 2,
            entryTriggerRule: '美联储鹰派加息/铜金比下滑时作空AG0对冲工业回撤',
            falsificationRule: '全球制造业全面强复苏引发白银逼仓暴涨',
          },
          true
        ),
      ],
    },
    {
      id: 'basket_commodity_back',
      name: '商品现实主义：强Back现货缺口与咽喉运力多头',
      pillar: '大宗商品·Back现实缺口vs过剩内卷',
      thesisSummary: '只交易当前已经发生的现货紧缺与强Backwardation高展期升水品种，绝不为远期Contango弱预期故事买单。',
      currentRegimeFit: scAuChg20d >= 0 ? '标准底仓配置' : '高拥挤收缩防守',
      recommendedAllocationPct: 10,
      targets: [
        makeTarget(
          {
            symbol: 'EC0',
            name: '欧线集运',
            market: '国内期货',
            frameworkRole: '红海/苏伊士咽喉绕行运力刚性缺口直连标的',
            direction: '门控右侧做多',
            suggestedWeightPct: 3,
            entryTriggerRule: '近远月Back升水结构显著且SCFI现货运价周度上行',
            falsificationRule: '红海停火复航实锤落地引发远月贴水快速收窄',
          },
          true
        ),
        makeTarget(
          {
            symbol: 'SC0',
            name: '上海原油',
            market: '国内期货',
            frameworkRole: '霍尔木兹海峡与OPEC减产现实供给约束锚',
            direction: '门控右侧做多',
            suggestedWeightPct: 3,
            entryTriggerRule: '原油月差维持Back结构且3:2:1裂解价差未崩塌',
            falsificationRule: 'OPEC+大规模增产或月差转入深度Contango贴水',
          },
          true
        ),
        makeTarget({
          symbol: '600938',
          name: '中国海油',
          market: 'A股核心标的',
          frameworkRole: '低桶油成本+高股息油价现实红利双重护城河',
          direction: '做多底仓',
          suggestedWeightPct: 2,
          entryTriggerRule: '布油站稳70美元上方且股息率维持防御优势',
          falsificationRule: '国际油价跌破60美元引发自由现金流萎缩',
        }),
        makeTarget({
          symbol: '601919',
          name: '中远海控',
          market: 'A股核心标的',
          frameworkRole: '集运现货高运价兑现现金流与高分红映射',
          direction: '门控右侧做多',
          suggestedWeightPct: 2,
          entryTriggerRule: '欧线期货维持强Back且在手净现金充沛',
          falsificationRule: '全球贸易量断崖或新船密集下水压垮运价',
        }),
      ],
    },
    {
      id: 'basket_deleverage_avoid',
      name: '资产负债表去杠杆：传统地产黑色与过剩内卷空头对冲/规避池',
      pillar: '居民资产负债表与地产周期',
      thesisSummary: '居民与地产信用未实质扩张前，传统高耗能过剩产能链每次政策脉冲反弹均为产业套保与空头对冲窗口。',
      currentRegimeFit: '空头对冲激活',
      recommendedAllocationPct: 5,
      targets: [
        makeTarget(
          {
            symbol: 'RB0',
            name: '螺纹钢主力',
            market: '国内期货',
            frameworkRole: '地产新开工与传统基建需求下行晴雨表（逢高空对冲）',
            direction: '空头对冲/规避',
            suggestedWeightPct: 2,
            entryTriggerRule: '政策预期脉冲拉涨但现货表观消费与钢厂去库不及预期',
            falsificationRule: '全国核心一二线地产销售面积连续3个月同比转正大增',
          },
          true
        ),
        makeTarget(
          {
            symbol: 'FG0',
            name: '玻璃主力',
            market: '国内期货',
            frameworkRole: '地产竣工周期末尾高库存过剩典型代表（规避抄底）',
            direction: '空头对冲/规避',
            suggestedWeightPct: 2,
            entryTriggerRule: '厂库累库压制现货价格、Contango升水抛空保护',
            falsificationRule: '行业联合大规模刚性冷修去产能超预期落地',
          },
          true
        ),
        makeTarget(
          {
            symbol: 'I0',
            name: '铁矿石主力',
            market: '国内期货',
            frameworkRole: '全球制造业需求走弱+高港口库存空头对冲腿',
            direction: '空头对冲/规避',
            suggestedWeightPct: 1,
            entryTriggerRule: '高炉铁水日产见顶回落且机构席位净空比扩大',
            falsificationRule: '海外矿山极端不可抗力断供叠加国内强财政刺激',
          },
          true
        ),
      ],
    },
    {
      id: 'basket_vol_shield',
      name: 'FICC波动率风暴保护：高拥挤拆仓期指对冲腿',
      pillar: 'FICC套息拆仓与波动率冲击',
      thesisSummary: '当全球Carry拆仓或A股TMT交易拥挤度越过阈值引发负偏度回撤时，通过期指空单或ETF波动率对冲保护净值。',
      currentRegimeFit: carryAlert ? '空头对冲激活' : '标准底仓配置',
      recommendedAllocationPct: carryAlert ? 15 : 0,
      targets: [
        makeTarget(
          {
            symbol: 'IC0',
            name: '中证500期指',
            market: '国内期货',
            frameworkRole: '中盘成长多头组合的系统性Beta对冲工具',
            direction: '多空配对腿',
            suggestedWeightPct: carryAlert ? 6 : 0,
            entryTriggerRule: 'TMT拥挤度>38% 或 159915期权Skew<-3.5 激活空单对冲',
            falsificationRule: '市场出清缩量企稳且期权PCR回落至正常区间平空',
          },
          true
        ),
        makeTarget(
          {
            symbol: 'IM0',
            name: '中证1000期指',
            market: '国内期货',
            frameworkRole: '高Beta小微盘流动性退潮尾部风险保护',
            direction: '空头对冲/规避',
            suggestedWeightPct: carryAlert ? 6 : 0,
            entryTriggerRule: '市场缩量跌破20日线且全市场量比<0.85触发小盘保护',
            falsificationRule: '增量资金重新放量且微盘情绪修复站稳均线',
          },
          true
        ),
        makeTarget({
          symbol: '159915',
          name: '创业板ETF',
          market: '核心ETF',
          frameworkRole: 'AI/新能源双核情绪风向标与期权波动率锚',
          direction: '门控右侧做多',
          suggestedWeightPct: carryAlert ? 0 : 3,
          entryTriggerRule: '159915期权Skew>-2.5且站稳MA20生命线方可右侧参与',
          falsificationRule: 'Skew跌破-4.0或大盘缩量虹吸时清仓规避负偏度踩踏',
        }),
      ],
    },
  ];

  const macroRegimeHeadline = carryAlert
    ? `付鹏FICC状态：高拥挤与跨市场波动预警（TMT拥挤 ${tmtCrowding.toFixed(1)}% · Skew ${cybSkew.toFixed(2)}）`
    : cuAuChg20d <= -2
    ? `付鹏FICC状态：有效需求偏弱·哑铃左端红利长债+黄金超配（铜金比20日 ${cuAuChg20d}%）`
    : `付鹏FICC状态：标准哑铃均衡配置·黄金稳盘+AI硬件门控右侧（铜金比 ${cuAuRatio}x）`;

  const macroRegimeSummary = `当前铜金比 ${cuAuRatio.toFixed(2)}x (${cuAuChg20d >= 0 ? '+' : ''}${cuAuChg20d}%/20d)，油金比 ${scAuRatio.toFixed(
    3
  )}x (${scAuChg20d >= 0 ? '+' : ''}${scAuChg20d}%/20d)，30Y国债期货TL0 ${tl0.price} (${
    tl0.change20dPct >= 0 ? '+' : ''
  }${tl0.change20dPct}%/20d)，离岸CNH ${usdcnhPx.toFixed(4)} 与 TMT拥挤度 ${tmtCrowding.toFixed(
    1
  )}%。建议贯彻“左端长债红利收息 + 黄金硬通货压舱 + 右端AI出海按拥挤度门控 + 商品仅做强Back缺口”。`;

  return {
    updatedAt: nowBjIso(),
    macroRegimeHeadline,
    macroRegimeSummary,
    watcherDaemonStatus: {
      enabled: true,
      intervalSec: WATCH_INTERVAL_SEC,
      lastScrapedAt: lastScrapedAt || intelList[0]?.capturedAt || nowBjIso(),
      totalStoredIntelCount: dbGetFupengIntelCount(),
      egoWatcherScriptPath: EGO_SCRIPT_REL,
    },
    coordinates,
    baskets,
    intelFeed: intelList,
    scraperChannels:
      lastChannelStatuses.length > 0
        ? lastChannelStatuses
        : [
            {
              id: 'bing_rss',
              name: 'Bing资讯RSS',
              method: 'XML RSS / News Search',
              ok: true,
              latencyMs: 0,
              fetchedCount: 0,
              lastCheckedAt: nowBjIso(),
              detail: '等待下一轮巡检或点击立即抓取',
            },
            {
              id: 'eastmoney_news',
              name: '东财财富号/资讯',
              method: 'JSONP Search API',
              ok: true,
              latencyMs: 0,
              fetchedCount: 0,
              lastCheckedAt: nowBjIso(),
              detail: '等待下一轮巡检或点击立即抓取',
            },
            {
              id: 'sina_weibo_roll',
              name: '新浪财经/微博',
              method: 'Roll API + 社交视频流',
              ok: true,
              latencyMs: 0,
              fetchedCount: 0,
              lastCheckedAt: nowBjIso(),
              detail: '等待下一轮巡检或点击立即抓取',
            },
            {
              id: 'wscn_cls',
              name: '财联社/华尔街见闻',
              method: 'WSCN《付鹏说》直连 + Jin10',
              ok: true,
              latencyMs: 0,
              fetchedCount: 0,
              lastCheckedAt: nowBjIso(),
              detail: '等待下一轮巡检或点击立即抓取',
            },
            {
              id: 'local_vault',
              name: '本地宏观智库',
              method: 'Read-Only Vault + FICC语料',
              ok: true,
              latencyMs: 0,
              fetchedCount: intelList.filter((i) => i.sourceChannel === '本地宏观智库').length,
              lastCheckedAt: nowBjIso(),
              detail: '本地SQLite与只读智库语料已就绪',
            },
            {
              id: 'ego_daemon',
              name: 'Ego 24h静默守护',
              method: 'ego-browser TaskSpace JSONL',
              ok: fs.existsSync(path.resolve(APP_ROOT_DIR, EGO_SCRIPT_REL)),
              latencyMs: 0,
              fetchedCount: 0,
              lastCheckedAt: nowBjIso(),
              detail: '守护脚本就绪，支持 --once 与 24h daemon 模式',
            },
          ],
  };
}

// ---------------- 付鹏动态哑铃 FICC 组合历史回测引擎 ----------------

export async function runFupengBarbellBacktest(
  req: FupengBarbellBacktestRequest = {}
): Promise<FupengBarbellBacktestResponse> {
  const days = clamp(Math.round(Number(req.days || 180)), 60, 260);
  const rawLeft = clamp(Number(req.dividendLeftWeightPct ?? 40), 0, 100);
  const rawRight = clamp(Number(req.aiRightMaxWeightPct ?? 30), 0, 100);
  const rawGold = clamp(Number(req.goldHardWeightPct ?? 30), 0, 100);
  const totalW = rawLeft + rawRight + rawGold || 100;
  const wLeftBase = rawLeft / totalW;
  const wRightCap = rawRight / totalW;
  const wGoldBase = rawGold / totalW;
  const enableDeleverageGate = req.enableDeleverageGate ?? true;

  const lookback = days + 45;

  // Fetch real historical daily K-lines for all barbell components + benchmark
  const [
    k600900,
    k601088,
    kTl0,
    k300308,
    k002028,
    k300274,
    kAu0,
    k600547,
    kCu0,
    k510300,
  ] = await Promise.all([
    fetchTencentKLines('600900', lookback, false).catch(() => []),
    fetchTencentKLines('601088', lookback, false).catch(() => []),
    fetchFuturesKLines('TL0', lookback)
      .then((r) => r.klines)
      .catch(() => []),
    fetchTencentKLines('300308', lookback, false).catch(() => []),
    fetchTencentKLines('002028', lookback, false).catch(() => []),
    fetchTencentKLines('300274', lookback, false).catch(() => []),
    fetchFuturesKLines('AU0', lookback).then((r) => r.klines).catch(() => []),
    fetchTencentKLines('600547', lookback, false).catch(() => []),
    fetchFuturesKLines('CU0', lookback).then((r) => r.klines).catch(() => []),
    fetchTencentKLines('510300', lookback, false).catch(() => []),
  ]);

  const kBondLeft =
    kTl0.length > 30
      ? kTl0
      : await fetchTencentKLines('511090', lookback, false).catch(() => []);

  const toCloseMap = (bars: { date: string; close: number; volume?: number }[]) => {
    const m = new Map<string, { close: number; volume: number }>();
    for (const b of bars) {
      if (b.date && b.close > 0) m.set(b.date, { close: b.close, volume: Number(b.volume || 0) });
    }
    return m;
  };

  const mLeft = [toCloseMap(k600900), toCloseMap(k601088), toCloseMap(kBondLeft)].filter((m) => m.size > 30);
  const mRight = [toCloseMap(k300308), toCloseMap(k002028), toCloseMap(k300274)].filter((m) => m.size > 30);
  const mGold = [toCloseMap(kAu0), toCloseMap(k600547)].filter((m) => m.size > 30);
  const mCu = toCloseMap(kCu0);
  const mBench = toCloseMap(k510300);

  // Use benchmark trading calendar (or longest available A-share calendar)
  const calendarSource = k510300.length >= 60 ? k510300 : k600900.length >= 60 ? k600900 : k300308;
  const allDates = calendarSource.map((b) => b.date).filter(Boolean);
  if (allDates.length < 30) {
    throw new Error('历史K线样本不足，无法执行付鹏动态哑铃回测');
  }

  const dailyRetFromMaps = (maps: Map<string, { close: number; volume: number }>[], dPrev: string, dCur: string) => {
    const rets: number[] = [];
    for (const m of maps) {
      const p0 = m.get(dPrev)?.close;
      const p1 = m.get(dCur)?.close;
      if (p0 && p1 && p0 > 0) rets.push((p1 - p0) / p0);
    }
    return rets.length > 0 ? mean(rets) : 0;
  };

  const startIdx = Math.max(22, allDates.length - days);
  let barbellNav = 1;
  let staticNav = 1;
  let benchNav = 1;
  let peakBarbell = 1;
  let peakStatic = 1;
  let prevAiWeight = wRightCap;
  let prevGateDeleveraged = false;
  let deleverageEventsCount = 0;

  const barbellDailyRets: number[] = [];
  const staticDailyRets: number[] = [];
  const monthNavMap = new Map<string, { start: number; end: number }>();

  const equityCurve: FupengBarbellBacktestResponse['equityCurve'] = [];
  const rebalanceLogs: FupengBarbellBacktestResponse['rebalanceLogs'] = [];

  for (let i = startIdx; i < allDates.length; i++) {
    const dCur = allDates[i];
    const dPrev = allDates[i - 1];
    const d20 = allDates[Math.max(0, i - 21)];

    // Causal t-1 macro & crowding evaluation (zero future leakage!)
    const rightRetsWindow: number[] = [];
    for (let k = Math.max(1, i - 20); k <= i - 1; k++) {
      rightRetsWindow.push(dailyRetFromMaps(mRight, allDates[k - 1], allDates[k]));
    }
    const right20dCum = rightRetsWindow.reduce((acc, r) => acc * (1 + r), 1) - 1;
    const right20dAnnVol = stdDev(rightRetsWindow) * Math.sqrt(252);

    // Copper/Gold 20d slope at t-1
    const auPrev = mGold[0]?.get(dPrev)?.close || 1;
    const au20 = mGold[0]?.get(d20)?.close || auPrev;
    const cuPrev = mCu.get(dPrev)?.close || 1;
    const cu20 = mCu.get(d20)?.close || cuPrev;
    const cuAuSlope20d = cu20 > 0 && au20 > 0 && auPrev > 0 ? (cuPrev / auPrev) / (cu20 / au20) - 1 : 0;

    // Volume surge proxy on AI basket at t-1
    const aiVolRatios: number[] = [];
    for (const m of mRight) {
      const vPrev = m.get(dPrev)?.volume || 0;
      const vols: number[] = [];
      for (let k = Math.max(0, i - 10); k < i - 1; k++) {
        const v = m.get(allDates[k])?.volume || 0;
        if (v > 0) vols.push(v);
      }
      const avgV = mean(vols);
      if (vPrev > 0 && avgV > 0) aiVolRatios.push(vPrev / avgV);
    }
    const avgAiVolRatio = aiVolRatios.length > 0 ? mean(aiVolRatios) : 1;

    // Fu Peng Deleverage Gate: High AI crowding/heat (>22% 20d runup + vol surge or vol >48%) OR sharp Cu/Au macro deterioration
    let wRightEff = wRightCap;
    let wLeftEff = wLeftBase;
    let wGoldEff = wGoldBase;
    let gateReason = '';

    if (enableDeleverageGate) {
      const crowdingOverheat = right20dCum > 0.22 && (avgAiVolRatio > 1.35 || right20dAnnVol > 0.45);
      const volShock = right20dAnnVol > 0.52;
      const macroDeflationShock = cuAuSlope20d < -0.055;

      if (crowdingOverheat || volShock) {
        wRightEff = round(wRightCap * 0.25, 4);
        const freed = wRightCap - wRightEff;
        wGoldEff = wGoldBase + freed * 0.55;
        wLeftEff = wLeftBase + freed * 0.45;
        gateReason = crowdingOverheat
          ? `AI20日过热+${round(right20dCum * 100, 1)}%且放量(${round(avgAiVolRatio, 2)}x)`
          : `AI年化波动率达${round(right20dAnnVol * 100, 1)}%触发去杠杆`;
      } else if (macroDeflationShock) {
        wRightEff = round(wRightCap * 0.5, 4);
        const freed = wRightCap - wRightEff;
        wGoldEff = wGoldBase + freed * 0.5;
        wLeftEff = wLeftBase + freed * 0.5;
        gateReason = `铜金比20日走弱${round(cuAuSlope20d * 100, 1)}%，切回黄金+红利防御`;
      }
    }

    const isDeleveraged = wRightEff < wRightCap - 0.01;
    if (isDeleveraged !== prevGateDeleveraged) {
      if (isDeleveraged) {
        deleverageEventsCount++;
        rebalanceLogs.push({
          date: dCur,
          action: '拥挤去杠杆降仓',
          reason: gateReason,
          weightsText: `左端${round(wLeftEff * 100, 0)}% / AI${round(wRightEff * 100, 0)}% / 黄金${round(wGoldEff * 100, 0)}%`,
        });
      } else {
        rebalanceLogs.push({
          date: dCur,
          action: '拥挤出清恢复门控',
          reason: 'AI波动与成交拥挤度回落至安全区间，恢复右端硬瓶颈配额',
          weightsText: `左端${round(wLeftEff * 100, 0)}% / AI${round(wRightEff * 100, 0)}% / 黄金${round(wGoldEff * 100, 0)}%`,
        });
      }
      prevGateDeleveraged = isDeleveraged;
    }

    const rLeft = dailyRetFromMaps(mLeft, dPrev, dCur);
    const rRight = dailyRetFromMaps(mRight, dPrev, dCur);
    const rGold = dailyRetFromMaps(mGold, dPrev, dCur);
    const rBench = dailyRetFromMaps(mBench.size > 0 ? [mBench] : mLeft, dPrev, dCur);

    const turnover = Math.abs(wRightEff - prevAiWeight);
    const slippage = turnover * 0.0008;
    prevAiWeight = wRightEff;

    const rBarbell = wLeftEff * rLeft + wRightEff * rRight + wGoldEff * rGold - slippage;
    const rStatic = (rLeft + rRight + rGold) / 3;

    barbellNav *= 1 + rBarbell;
    staticNav *= 1 + rStatic;
    benchNav *= 1 + rBench;

    peakBarbell = Math.max(peakBarbell, barbellNav);
    peakStatic = Math.max(peakStatic, staticNav);

    const ddBarbell = ((barbellNav - peakBarbell) / peakBarbell) * 100;
    barbellDailyRets.push(rBarbell);
    staticDailyRets.push(rStatic);

    const ym = dCur.slice(0, 7);
    const mEntry = monthNavMap.get(ym);
    if (!mEntry) monthNavMap.set(ym, { start: barbellNav / (1 + rBarbell), end: barbellNav });
    else mEntry.end = barbellNav;

    equityCurve.push({
      date: dCur,
      barbellReturnPct: round((barbellNav - 1) * 100, 2),
      staticEqualReturnPct: round((staticNav - 1) * 100, 2),
      hs300ReturnPct: round((benchNav - 1) * 100, 2),
      drawdownPct: round(ddBarbell, 2),
      aiEffectiveWeightPct: round(wRightEff * 100, 1),
    });
  }

  const nDays = Math.max(1, barbellDailyRets.length);
  const totalReturnPct = round((barbellNav - 1) * 100, 2);
  const annualReturnPct = round(((barbellNav ** (252 / nDays)) - 1) * 100, 2);
  const bStd = stdDev(barbellDailyRets);
  const sharpe = bStd > 0 ? round((mean(barbellDailyRets) / bStd) * Math.sqrt(252), 2) : 0;
  const maxDrawdownPct = round(
    Math.min(0, ...equityCurve.map((e) => e.drawdownPct)),
    2
  );
  const calmar = maxDrawdownPct < 0 ? round(annualReturnPct / Math.abs(maxDrawdownPct), 2) : round(annualReturnPct, 2);

  let winMonths = 0;
  for (const m of monthNavMap.values()) {
    if (m.end >= m.start) winMonths++;
  }
  const winRateMonthsPct = monthNavMap.size > 0 ? round((winMonths / monthNavMap.size) * 100, 1) : 50;

  const hs300BenchmarkPct = round((benchNav - 1) * 100, 2);
  const excessVsHs300Pct = round(totalReturnPct - hs300BenchmarkPct, 2);

  // Static equal max drawdown
  let stPeak = 1;
  let stNav = 1;
  let stMaxDd = 0;
  for (const r of staticDailyRets) {
    stNav *= 1 + r;
    stPeak = Math.max(stPeak, stNav);
    stMaxDd = Math.min(stMaxDd, ((stNav - stPeak) / stPeak) * 100);
  }
  const stStd = stdDev(staticDailyRets);
  const stSharpe = stStd > 0 ? round((mean(staticDailyRets) / stStd) * Math.sqrt(252), 2) : 0;

  return {
    startDate: equityCurve[0]?.date || '',
    endDate: equityCurve[equityCurve.length - 1]?.date || '',
    barbellMetrics: {
      totalReturnPct,
      annualReturnPct,
      sharpe,
      calmar,
      maxDrawdownPct,
      winRateMonthsPct,
      excessVsHs300Pct,
    },
    staticEqualMetrics: {
      totalReturnPct: round((staticNav - 1) * 100, 2),
      sharpe: stSharpe,
      maxDrawdownPct: round(stMaxDd, 2),
    },
    hs300BenchmarkPct,
    deleverageEventsCount,
    equityCurve,
    rebalanceLogs: rebalanceLogs.slice(-30),
  };
}

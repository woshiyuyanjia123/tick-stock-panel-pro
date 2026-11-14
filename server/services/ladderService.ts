import type {
  BoardFilter,
  LadderPool,
  LadderResponse,
  LadderStockItem,
  StockQuoteItem,
} from '../../src/types/market';
import {
  type EMPoolRaw,
  fetchAllAShareSnapshots,
  fetchDTPool,
  fetchZBPool,
  fetchZTPool,
} from '../providers/eastmoney';
import { fetchTencentQuotes, resolveTradingDates } from '../providers/tencent';
import {
  cleanCode,
  formatTimeInt,
  getBoardBadge,
  getBoardType,
  getLimitRatio,
} from '../utils/marketHelpers';

function mapPoolItem(
  raw: EMPoolRaw,
  poolType: LadderPool,
  prevStreakMap: Map<string, number>,
  quoteMap: Map<string, StockQuoteItem>
): LadderStockItem {
  const code = cleanCode(raw.c);
  const name = raw.n || code;
  const board = getBoardType(code, name);
  const q = quoteMap.get(code);
  const price = raw.p > 0 ? Number((raw.p / 1000).toFixed(2)) : q?.price || 0;
  const changePct =
    typeof raw.zdp === 'number' && Number.isFinite(raw.zdp)
      ? Number(raw.zdp.toFixed(2))
      : q?.changePct || 0;
  const streak = raw.lbc ?? (poolType === 'zt' ? 1 : 0);
  const yesterdayStreak = prevStreakMap.get(code) || 0;

  let statusTag = '';
  if (poolType === 'zt') {
    if (raw.zttj && raw.zttj.days > 1) {
      statusTag = `${raw.zttj.days}天${raw.zttj.ct}板`;
    } else if (streak > 1) {
      statusTag = `${streak}连板`;
    } else {
      statusTag = '首板';
    }
  } else if (poolType === 'zb') {
    statusTag =
      yesterdayStreak > 0
        ? `昨日${yesterdayStreak}板炸板 (开板${raw.zbc ?? 1}次)`
        : `炸板回落 (开板${raw.zbc ?? 1}次)`;
  } else {
    statusTag =
      yesterdayStreak > 1
        ? `昨日连板今日中断 (昨日${yesterdayStreak}板)`
        : `昨日首板未晋级 (昨日1板)`;
  }

  return {
    code,
    name,
    board,
    boardBadge: getBoardBadge(board),
    price,
    changePct,
    streak: poolType === 'db' ? yesterdayStreak : streak,
    yesterdayStreak,
    firstSealTime: formatTimeInt(raw.fbt),
    lastSealTime: formatTimeInt(raw.lbt),
    openCount: raw.zbc ?? 0,
    sealAmount: raw.fund ?? 0,
    turnoverRate: Number((raw.hs || q?.turnoverRate || 0).toFixed(2)),
    amount: raw.amount || q?.amount || 0,
    marketCap: raw.ltsz || q?.floatMarketCap || q?.marketCap || 0,
    reason: raw.zttj && raw.zttj.ct > 1 ? `${raw.zttj.days}天${raw.zttj.ct}板` : raw.hybk || '',
    industry: raw.hybk || q?.industry || '综合',
    industryPath: raw.hybk ? `东财行业 · ${raw.hybk}` : 'A股主板',
    concepts: raw.hybk ? [raw.hybk] : [],
    statusTag,
  };
}

function buildDistCounts(items: LadderStockItem[], field: 'industry' | 'concepts', limit = 24) {
  const counts = new Map<string, number>();
  for (const s of items) {
    if (field === 'industry') {
      if (s.industry) counts.set(s.industry, (counts.get(s.industry) || 0) + 1);
    } else {
      for (const c of s.concepts) {
        counts.set(c, (counts.get(c) || 0) + 1);
      }
      if (s.industry) counts.set(s.industry, (counts.get(s.industry) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getLadderData(params?: {
  date?: string;
  pool?: LadderPool;
  board?: BoardFilter;
}): Promise<LadderResponse> {
  const pool: LadderPool = params?.pool || 'zt';
  const board: BoardFilter = params?.board || 'all';
  const dates = await resolveTradingDates();
  const targetDate = params?.date || dates.latestDate;
  const compactDate = targetDate.replace(/-/g, '');

  // Determine previous trading date for broken-streak (断板) comparison
  let prevCompact = dates.prevCompact;
  const idx = dates.recentDates.indexOf(targetDate);
  if (idx > 0) {
    prevCompact = dates.recentDates[idx - 1].replace(/-/g, '');
  }

  const [ztRaw, zbRaw, dtRaw, prevZtRaw, snapshots] = await Promise.all([
    fetchZTPool(compactDate).catch(() => [] as EMPoolRaw[]),
    fetchZBPool(compactDate).catch(() => [] as EMPoolRaw[]),
    fetchDTPool(compactDate).catch(() => [] as EMPoolRaw[]),
    fetchZTPool(prevCompact).catch(() => [] as EMPoolRaw[]),
    fetchAllAShareSnapshots().catch(() => [] as StockQuoteItem[]),
  ]);

  const quoteMap = new Map<string, StockQuoteItem>();
  for (const s of snapshots) {
    quoteMap.set(cleanCode(s.code), s);
  }

  // Fallback if ZT pool came back empty during non-standard time
  let effectiveZtRaw = ztRaw;
  if (effectiveZtRaw.length === 0 && snapshots.length > 0) {
    effectiveZtRaw = snapshots
      .filter((s) => {
        const limit = getLimitRatio(s.code, s.name) * 100;
        return s.changePct >= limit - 0.35;
      })
      .map((s) => ({
        c: s.code,
        m: 0,
        n: s.name,
        p: Math.round(s.price * 1000),
        zdp: s.changePct,
        amount: s.amount,
        ltsz: s.floatMarketCap || s.marketCap || 0,
        tshare: s.marketCap || 0,
        hs: s.turnoverRate,
        lbc: 1,
        fbt: 0,
        lbt: 0,
        fund: 0,
        zbc: 0,
        hybk: s.industry || '其他',
      }));
  }

  const prevStreakMap = new Map<string, number>();
  for (const p of prevZtRaw) {
    prevStreakMap.set(cleanCode(p.c), p.lbc || 1);
  }

  const ztCodes = new Set(effectiveZtRaw.map((x) => cleanCode(x.c)));

  // Broken-streak (断板): in yesterday's ZT pool, NOT in today's ZT pool
  const dbMissingCodes: string[] = [];
  const dbRawList: EMPoolRaw[] = [];
  for (const p of prevZtRaw) {
    const code = cleanCode(p.c);
    if (!ztCodes.has(code)) {
      dbRawList.push(p);
      if (!quoteMap.has(code)) dbMissingCodes.push(code);
    }
  }
  if (dbMissingCodes.length > 0) {
    const extra = await fetchTencentQuotes(dbMissingCodes);
    for (const [k, v] of Object.entries(extra)) {
      quoteMap.set(cleanCode(k), v);
    }
  }

  let items: LadderStockItem[] = [];
  if (pool === 'zt') {
    items = effectiveZtRaw.map((r) => mapPoolItem(r, 'zt', prevStreakMap, quoteMap));
  } else if (pool === 'zb') {
    items = zbRaw.map((r) => mapPoolItem(r, 'zb', prevStreakMap, quoteMap));
  } else {
    items = dbRawList.map((r) => {
      const code = cleanCode(r.c);
      const q = quoteMap.get(code);
      const mapped = mapPoolItem(
        {
          ...r,
          p: q ? Math.round(q.price * 1000) : r.p,
          zdp: q ? q.changePct : 0,
          hs: q ? q.turnoverRate : r.hs,
          amount: q ? q.amount : r.amount,
        },
        'db',
        prevStreakMap,
        quoteMap
      );
      return mapped;
    });
  }

  const filtered =
    board === 'all' ? items : items.filter((item) => item.board === board);

  // Build tiers
  const tierMap = new Map<number, LadderStockItem[]>();
  for (const s of filtered) {
    const k = pool === 'db' ? s.yesterdayStreak || 1 : s.streak || 1;
    if (!tierMap.has(k)) tierMap.set(k, []);
    tierMap.get(k)!.push(s);
  }

  const sortedStreaks = Array.from(tierMap.keys()).sort((a, b) => b - a);
  const tiers = sortedStreaks.map((streak) => ({
    streak,
    label: pool === 'db' ? `昨日${streak}板` : streak === 1 ? '首板' : `${streak}连板`,
    stocks: tierMap.get(streak)!,
  }));

  const tierCounts = tiers.map((t) => ({
    streak: t.streak,
    label: t.label,
    count: t.stocks.length,
  }));

  const limitUpCount = effectiveZtRaw.length;
  const brokenCount = zbRaw.length;
  const limitDownCount = dtRaw.length;
  const brokenStreakCount = dbRawList.length;
  const sealRate = Math.round((limitUpCount / Math.max(1, limitUpCount + brokenCount)) * 100);

  const promotedCount = effectiveZtRaw.filter((z) => prevStreakMap.has(cleanCode(z.c))).length;
  const auditNote = `涨停来源 ${targetDate} · 涨停 ${limitUpCount} 只 · 炸板 ${brokenCount} 只 · 昨日涨停 ${prevZtRaw.length} 只（今日晋级 ${promotedCount} 只 / 断板 ${brokenStreakCount} 只）。封板率 ${sealRate}%，数据来自东财涨停/炸板/跌停池实盘核验。`;

  return {
    date: targetDate,
    pool,
    board,
    limitUpCount,
    limitDownCount,
    brokenCount,
    brokenStreakCount,
    sealRate,
    auditNote,
    updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    tierCounts,
    conceptDist: buildDistCounts(filtered, 'concepts', 24),
    industryDist: buildDistCounts(filtered, 'industry', 20),
    tiers,
    stocks: filtered,
  };
}

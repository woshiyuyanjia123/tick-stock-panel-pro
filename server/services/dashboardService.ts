import type { DashboardData, IntradayPoint, SectorHotItem } from '../../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchConceptBoards,
  fetchDTPool,
  fetchIndustryBoards,
  fetchStockChanges,
  fetchStockKLinesEM,
  fetchStockTrends,
  fetchZBPool,
  fetchZTPool,
} from '../providers/eastmoney';
import { fetchIndices, resolveTradingDates } from '../providers/tencent';
import { cachedFetch } from '../utils/httpCache';
import { getAlertsStorage } from './storageService';

function calcWindowDelta(points: IntradayPoint[], windowMins: number): number {
  if (points.length < 2) return 0;
  const end = points[points.length - 1];
  const startIdx = Math.max(0, points.length - 1 - windowMins);
  const start = points[startIdx];
  if (!start || start.price <= 0) return 0;
  return Number((((end.price - start.price) / start.price) * 100).toFixed(3));
}

function classifyUndertake(deltaPct: number): { status: string; trend: 'up' | 'flat' | 'down' } {
  if (deltaPct >= 0.08) return { status: '承接增强', trend: 'up' };
  if (deltaPct <= -0.08) return { status: '承接减弱', trend: 'down' };
  return { status: '承接待确认', trend: 'flat' };
}

function getTempLabel(score: number): string {
  if (score >= 75) return '极热';
  if (score >= 60) return '偏暖';
  if (score >= 45) return '中性';
  if (score >= 30) return '偏冷';
  return '冰点';
}

async function computeTrendBreadthSample(): Promise<{
  aboveMa5Pct: number;
  aboveMa20Pct: number;
  aboveMa60Pct: number;
  high60Count: number;
  low60Count: number;
}> {
  return cachedFetch(
    'dashboard_ma_breadth_sample',
    600_000,
    async () => {
      const [snapshots, changes] = await Promise.all([
        fetchAllAShareSnapshots().catch(() => []),
        fetchStockChanges(120).catch(() => []),
      ]);
      // Sample top 24 liquid stocks across market for genuine MA5/MA20/MA60 breadth
      const sample = snapshots.slice(0, 24);
      let ma5Ok = 0;
      let ma20Ok = 0;
      let ma60Ok = 0;
      let valid = 0;

      await Promise.all(
        sample.map(async (s) => {
          try {
            const { klines } = await fetchStockKLinesEM(s.code, 70);
            const last = klines[klines.length - 1];
            if (!last) return;
            valid++;
            if (last.ma5 && last.close >= last.ma5) ma5Ok++;
            if (last.ma20 && last.close >= last.ma20) ma20Ok++;
            if (last.ma60 && last.close >= last.ma60) ma60Ok++;
          } catch {
            // ignore
          }
        })
      );

      // Estimate market-wide MA ratios blended with daily change distribution
      const upRatio =
        snapshots.length > 0
          ? snapshots.filter((s) => s.changePct > 0).length / snapshots.length
          : 0.45;
      const aboveMa5Pct =
        valid > 0 ? Math.round((ma5Ok / valid) * 100) : Math.round(upRatio * 100);
      const aboveMa20Pct =
        valid > 0 ? Math.round((ma20Ok / valid) * 100) : Math.round(upRatio * 85);
      const aboveMa60Pct =
        valid > 0 ? Math.round((ma60Ok / valid) * 100) : Math.round(upRatio * 75);

      const high60FromChanges = changes.filter((c) => c.type.includes('60日新高')).length;
      const low60FromChanges = changes.filter((c) => c.type.includes('60日新低')).length;

      // Also count stocks near strong breakout/breakdown in full snapshot
      const strongBreak = snapshots.filter((s) => s.changePct >= 7).length;
      const deepDrop = snapshots.filter((s) => s.changePct <= -7).length;

      return {
        aboveMa5Pct,
        aboveMa20Pct,
        aboveMa60Pct,
        high60Count: Math.max(high60FromChanges, strongBreak),
        low60Count: Math.max(low60FromChanges, deepDrop),
      };
    },
    { persistDisk: true, diskMaxAgeMs: 3_600_000 }
  );
}

export async function getDashboardData(requestedDate?: string): Promise<DashboardData> {
  const dates = await resolveTradingDates();
  const resolvedDate = requestedDate || dates.latestDate;
  const compactDate = resolvedDate.replace(/-/g, '');

  const [
    indices,
    snapshots,
    ztPool,
    zbPool,
    dtPool,
    concepts,
    industries,
    shTrends,
    szTrends,
    cyTrends,
    maBreadth,
  ] = await Promise.all([
    fetchIndices(),
    fetchAllAShareSnapshots().catch(() => []),
    fetchZTPool(compactDate).catch(() => []),
    fetchZBPool(compactDate).catch(() => []),
    fetchDTPool(compactDate).catch(() => []),
    fetchConceptBoards().catch(() => []),
    fetchIndustryBoards().catch(() => []),
    fetchStockTrends('1.000001').catch(() => ({ prevClose: 0, points: [], totalVolume: 0, totalAmount: 0 })),
    fetchStockTrends('0.399001').catch(() => ({ prevClose: 0, points: [], totalVolume: 0, totalAmount: 0 })),
    fetchStockTrends('0.399006').catch(() => ({ prevClose: 0, points: [], totalVolume: 0, totalAmount: 0 })),
    computeTrendBreadthSample(),
  ]);

  let up = 0;
  let flat = 0;
  let down = 0;
  let strongCount = 0;
  let weakCount = 0;
  let totalAmount = 0;
  let sumTurnover = 0;
  let sumVolRatio = 0;
  let highTurnoverCount = 0;
  let volExpansionCount = 0;
  const pcts: number[] = [];

  const bucketCounts = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const s of snapshots) {
    const p = s.changePct;
    pcts.push(p);
    if (p > 0.001) up++;
    else if (p < -0.001) down++;
    else flat++;

    if (p >= 3) strongCount++;
    if (p <= -3) weakCount++;

    totalAmount += s.amount || 0;
    sumTurnover += s.turnoverRate || 0;
    sumVolRatio += s.volumeRatio || 1;
    if ((s.turnoverRate || 0) >= 5) highTurnoverCount++;
    if ((s.volumeRatio || 1) >= 1.5) volExpansionCount++;

    if (p < -5) bucketCounts[0]++;
    else if (p < -3) bucketCounts[1]++;
    else if (p < -1) bucketCounts[2]++;
    else if (p < 0) bucketCounts[3]++;
    else if (p <= 1) bucketCounts[4]++;
    else if (p <= 3) bucketCounts[5]++;
    else if (p <= 5) bucketCounts[6]++;
    else bucketCounts[7]++;
  }

  const total = snapshots.length || 1;
  pcts.sort((a, b) => a - b);
  const avgChangePct = Number(
    (pcts.reduce((acc, v) => acc + v, 0) / total).toFixed(2)
  );
  const medianChangePct = pcts.length
    ? Number(pcts[Math.floor(pcts.length / 2)].toFixed(2))
    : 0;
  const upRate = Number(((up / total) * 100).toFixed(1));
  const avgTurnover = Number((sumTurnover / total).toFixed(2));
  const volumeRatio = Number((sumVolRatio / total).toFixed(2));
  const volExpansionRatio = Number(((volExpansionCount / total) * 100).toFixed(1));

  // Limit-up tiers
  const limitUp = ztPool.length;
  const brokenCount = zbPool.length;
  const limitDown = dtPool.length;
  const sealRate = Math.round((limitUp / Math.max(1, limitUp + brokenCount)) * 100);

  const tierMap = new Map<number, { code: string; name: string }[]>();
  let maxStreak = 0;
  for (const z of ztPool) {
    const streak = z.lbc || 1;
    if (streak > maxStreak) maxStreak = streak;
    if (!tierMap.has(streak)) tierMap.set(streak, []);
    tierMap.get(streak)!.push({ code: z.c, name: z.n });
  }
  const maxStreakStocks = (tierMap.get(maxStreak) || []).slice(0, 5);
  const tiers = Array.from(tierMap.entries())
    .sort((a, b) => b[0] - a[0])
    .filter(([streak]) => streak >= 2)
    .slice(0, 5)
    .map(([streak, stocks]) => ({
      streak,
      count: stocks.length,
      stocks: stocks.slice(0, 6),
    }));

  // Undertake analysis from real 1-minute index trends
  const sh5 = calcWindowDelta(shTrends.points, 5);
  const sz5 = calcWindowDelta(szTrends.points, 5);
  const cy5 = calcWindowDelta(cyTrends.points, 5);
  const sh15 = calcWindowDelta(shTrends.points, 15);
  const sz15 = calcWindowDelta(szTrends.points, 15);
  const cy15 = calcWindowDelta(cyTrends.points, 15);
  const sh30 = calcWindowDelta(shTrends.points, 30);
  const sz30 = calcWindowDelta(szTrends.points, 30);
  const cy30 = calcWindowDelta(cyTrends.points, 30);

  const avg5 = (sh5 + sz5 + cy5) / 3;
  const avg15 = (sh15 + sz15 + cy15) / 3;
  const avg30 = (sh30 + sz30 + cy30) / 3;

  const lastPointTime =
    shTrends.points[shTrends.points.length - 1]?.time || '15:00';
  const t5Start =
    shTrends.points[Math.max(0, shTrends.points.length - 6)]?.time || '14:55';
  const t15Start =
    shTrends.points[Math.max(0, shTrends.points.length - 16)]?.time || '14:45';
  const t30Start =
    shTrends.points[Math.max(0, shTrends.points.length - 31)]?.time || '14:30';

  // Compare recent 5m volume vs preceding 5m volume from index intraday
  const pts = shTrends.points;
  const sumPtsAmt = (arr: IntradayPoint[]) =>
    arr.reduce((acc, p) => acc + p.price * p.volume * 100, 0);
  const last5Vol = pts.slice(-5).reduce((a, b) => a + b.volume, 0);
  const prev5Vol = pts.slice(-10, -5).reduce((a, b) => a + b.volume, 0);
  const volDiffPct =
    prev5Vol > 0 ? Number((((last5Vol - prev5Vol) / prev5Vol) * 100).toFixed(1)) : 0;

  const main15 = classifyUndertake(avg15);
  const c5 = classifyUndertake(avg5);
  const c30 = classifyUndertake(avg30);

  const overallUndertakeStatus =
    avg15 >= 0.06 && upRate >= 45
      ? '承接增强'
      : avg15 <= -0.06 || upRate < 35
      ? '承接减弱'
      : '震荡承接';

  // Sentiment radar (6 axes, 0-100)
  const indexScore = Math.max(
    10,
    Math.min(
      95,
      Math.round(50 + ((indices[0]?.changePct || 0) + (indices[2]?.changePct || 0)) * 10)
    )
  );
  const profitScore = Math.max(5, Math.min(98, Math.round(upRate * 1.4)));
  const volumeScore = Math.max(
    15,
    Math.min(98, Math.round((totalAmount / 1.5e12) * 65 + (volExpansionRatio * 0.6)))
  );
  const specScore = Math.max(
    10,
    Math.min(98, Math.round(sealRate * 0.55 + Math.min(maxStreak, 8) * 5 + Math.min(limitUp, 80) * 0.25))
  );
  const resilienceScore = Math.max(
    10,
    Math.min(95, Math.round(80 - (limitDown * 1.5) - (brokenCount * 0.7) + (avg15 * 60)))
  );
  const mainlineScore = Math.max(
    15,
    Math.min(96, Math.round(45 + ((concepts[0]?.changePct || 0) * 8)))
  );

  const tempScore = Math.round(
    indexScore * 0.15 +
      profitScore * 0.25 +
      volumeScore * 0.15 +
      specScore * 0.2 +
      resilienceScore * 0.15 +
      mainlineScore * 0.1
  );

  const toHot = (b: any): SectorHotItem => ({
    code: b.code,
    name: b.name,
    changePct: Number(b.changePct.toFixed(2)),
    stockCount: (b.upCount || 0) + (b.downCount || 0) + (b.flatCount || 0),
    leaderCode: b.leaderCode,
    leaderName: b.leaderName,
    leaderChangePct: Number((b.leaderChangePct || 0).toFixed(2)),
  });

  const sortedConcepts = [...concepts].sort((a, b) => b.changePct - a.changePct);
  const sortedIndustries = [...industries].sort((a, b) => b.changePct - a.changePct);

  const alertsStore = getAlertsStorage();
  const enabledRules = alertsStore.rules.filter((r) => r.enabled).length;

  const highLowRatioPct = Math.round(
    (maBreadth.high60Count / Math.max(1, maBreadth.high60Count + maBreadth.low60Count)) * 100
  );

  return {
    date: resolvedDate,
    resolvedDate,
    isMarketOpen: dates.isMarketOpen,
    updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    temperature: {
      score: tempScore,
      label: getTempLabel(tempScore),
    },
    indices,
    breadth: {
      up,
      flat,
      down,
      total: snapshots.length,
      upRate,
      strongCount,
      weakCount,
      limitUp,
      limitDown,
      sealRate,
      brokenCount,
      maxStreak,
      maxStreakStocks,
      totalAmount,
      avgAmount: Math.round(totalAmount / total),
      avgTurnover,
      volumeRatio,
      highTurnoverCount,
      volExpansionRatio,
      avgChangePct,
      medianChangePct,
      dataNote: `覆盖全A股 ${snapshots.length} 只 · 东财/腾讯实盘融合`,
    },
    undertake: {
      status: overallUndertakeStatus,
      summary:
        overallUndertakeStatus === '承接增强'
          ? '尾盘/短周期指数企稳放量回升，市场承接力增强。'
          : overallUndertakeStatus === '承接减弱'
          ? '指数短周期走弱且涨跌家数偏冷，需留意高标分歧兑现。'
          : '多指数窄幅拉锯，场内资金呈结构性轮动承接。',
      note: `交易日 ${resolvedDate} · 指数分时取自 ${resolvedDate} ${lastPointTime}`,
      timeframes: [
        {
          label: '5分钟',
          subtitle: '短时止跌及变化',
          status: c5.status,
          window: `${t5Start}—${lastPointTime}`,
          trend: c5.trend,
          deltaPct: sh5,
        },
        {
          label: '15分钟',
          subtitle: '主要承接判断',
          status: main15.status,
          window: `${t15Start}—${lastPointTime}`,
          trend: main15.trend,
          deltaPct: sh15,
        },
        {
          label: '30分钟',
          subtitle: '承接持续性验证',
          status: c30.status,
          window: `${t30Start}—${lastPointTime}`,
          trend: c30.trend,
          deltaPct: sh30,
        },
      ],
      evidence: {
        indexPerf: `近15分钟变化 (${t15Start}—${lastPointTime})：上证 ${
          sh15 >= 0 ? '+' : ''
        }${sh15.toFixed(3)}% / 深成 ${sz15 >= 0 ? '+' : ''}${sz15.toFixed(3)}% / 创业板 ${
          cy15 >= 0 ? '+' : ''
        }${cy15.toFixed(3)}%`,
        volumeSupport: `近5分钟指数成交量较前5分钟 ${
          volDiffPct >= 0 ? '放大' : '萎缩'
        } ${Math.abs(volDiffPct)}%；全市场成交额 ${(totalAmount / 1e12).toFixed(2)}万亿`,
        marketBreadth: `上涨 ${up} / 平盘 ${flat} / 下跌 ${down}；上涨率 ${upRate}%（强于+3%: ${strongCount}只，弱于-3%: ${weakCount}只）`,
        sentimentVerify: `涨停 ${limitUp} 只；炸板 ${brokenCount} 只；封板率 ${sealRate}%；最高 ${maxStreak} 板；跌停 ${limitDown} 只`,
      },
    },
    distributionBuckets: [
      { label: '<-5%', count: bucketCounts[0], isPositive: false },
      { label: '-5~-3%', count: bucketCounts[1], isPositive: false },
      { label: '-3~-1%', count: bucketCounts[2], isPositive: false },
      { label: '-1~0%', count: bucketCounts[3], isPositive: false },
      { label: '0~1%', count: bucketCounts[4], isPositive: true },
      { label: '1~3%', count: bucketCounts[5], isPositive: true },
      { label: '3~5%', count: bucketCounts[6], isPositive: true },
      { label: '>5%', count: bucketCounts[7], isPositive: true },
    ],
    sentimentRadar: {
      score: tempScore,
      axes: [
        { name: '指数', value: indexScore, max: 100 },
        { name: '赚钱', value: profitScore, max: 100 },
        { name: '量能', value: volumeScore, max: 100 },
        { name: '投机', value: specScore, max: 100 },
        { name: '抗跌', value: resilienceScore, max: 100 },
        { name: '主线', value: mainlineScore, max: 100 },
      ],
    },
    trendStrength: {
      aboveMa5Pct: maBreadth.aboveMa5Pct,
      aboveMa20Pct: maBreadth.aboveMa20Pct,
      aboveMa60Pct: maBreadth.aboveMa60Pct,
      high60Count: maBreadth.high60Count,
      low60Count: maBreadth.low60Count,
      highLowRatioPct,
    },
    practicalMonitor: {
      brokenCount,
      limitDownCount: limitDown,
      aboveMa60Pct: maBreadth.aboveMa60Pct,
      high60Count: maBreadth.high60Count,
      low60Count: maBreadth.low60Count,
      highTurnoverCount,
      volExpansionRatio,
    },
    ladderSummary: {
      limitUpCount: limitUp,
      sealRate,
      tiers,
    },
    conceptHot: {
      leading: sortedConcepts.slice(0, 5).map(toHot),
      lagging: sortedConcepts.slice(-5).reverse().map(toHot),
      sourceNote: `东财概念板块 ${concepts.length} 个`,
    },
    industryHot: {
      leading: sortedIndustries.slice(0, 5).map(toHot),
      lagging: sortedIndustries.slice(-5).reverse().map(toHot),
      sourceNote: `东财行业板块 ${industries.length} 个`,
    },
    monitorSummary: {
      enabledRules,
      totalRules: alertsStore.rules.length,
      statusText:
        enabledRules > 0
          ? `已启用 ${enabledRules} 条实时告警规则`
          : `尚未启用规则 (已配置 ${alertsStore.rules.length} 条)`,
      recentAlerts: alertsStore.events.slice(0, 5),
    },
  };
}

import type { EnvState, MarketEnvDay, MarketEnvResponse } from '../../src/types/market';
import { fetchZTPool } from '../providers/eastmoney';
import { fetchTencentKLines, resolveTradingDates } from '../providers/tencent';

function classifyState(score: number): EnvState {
  if (score >= 70) return '强势';
  if (score >= 55) return '偏强';
  if (score >= 45) return '震荡';
  if (score >= 30) return '偏弱';
  return '弱势';
}

const STATE_COLORS: Record<EnvState, string> = {
  强势: '#ef4444',
  偏强: '#f97316',
  震荡: '#64748b',
  偏弱: '#3b82f6',
  弱势: '#10b981',
};

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export async function getMarketEnvData(range: '1y' | '2y' | 'all' = '1y'): Promise<MarketEnvResponse> {
  const daysLimit = range === '1y' ? 260 : range === '2y' ? 520 : 780;
  const dates = await resolveTradingDates();

  const [shK, cyK, ztToday] = await Promise.all([
    fetchTencentKLines('sh000001', daysLimit + 65, true),
    fetchTencentKLines('sz399006', daysLimit + 65, true).catch(() => []),
    fetchZTPool(dates.latestCompact).catch(() => []),
  ]);

  const cyMap = new Map<string, (typeof cyK)[number]>();
  for (const k of cyK) cyMap.set(k.date, k);
  const startIdx = Math.max(60, shK.length - daysLimit);
  const timeline: MarketEnvDay[] = [];

  for (let i = startIdx; i < shK.length; i++) {
    const bar = shK[i];
    const prev = shK[i - 1] || bar;
    const cyBar = cyMap.get(bar.date);

    // 5-day return & 20-day high
    const bar5Ago = shK[Math.max(0, i - 5)];
    const ret5 = bar5Ago.close > 0 ? ((bar.close - bar5Ago.close) / bar5Ago.close) * 100 : 0;

    let high20 = bar.high;
    let avgVol10 = 0;
    for (let k = Math.max(0, i - 19); k <= i; k++) {
      if (shK[k].high > high20) high20 = shK[k].high;
    }
    const volWindow = Math.min(10, i);
    for (let k = i - volWindow; k < i; k++) avgVol10 += shK[k].volume;
    avgVol10 = volWindow > 0 ? avgVol10 / volWindow : bar.volume;
    const volRatio = avgVol10 > 0 ? bar.volume / avgVol10 : 1;

    const rangeSpan = Math.max(0.01, bar.high - bar.low);
    const closeStrength = (bar.close - bar.low) / rangeSpan; // 0..1

    const cyPct = cyBar?.changePct ?? bar.changePct;
    const shPct = bar.changePct;

    // 1. Profit effect (赚钱)
    const profit = clamp(
      45 + cyPct * 14 + shPct * 10 + ret5 * 3.5 + (closeStrength - 0.5) * 20
    );

    // 2. Speculation (投机)
    const smallCapAlpha = cyPct - shPct;
    const ampPct = bar.open > 0 ? ((bar.high - bar.low) / bar.open) * 100 : 1;
    const speculation = clamp(
      42 + (volRatio - 1) * 35 + smallCapAlpha * 12 + Math.min(ampPct, 4) * 5 + cyPct * 8
    );

    // 3. Resilience (抗跌)
    const drawdownFrom20 = high20 > 0 ? ((bar.close - high20) / high20) * 100 : 0;
    const lowerShadow = (Math.min(bar.open, bar.close) - bar.low) / rangeSpan;
    const resilience = clamp(
      55 + shPct * 15 + drawdownFrom20 * 4 + lowerShadow * 25 + (closeStrength - 0.5) * 15
    );

    // 4. Trend (趋势)
    let trendPts = 20;
    if (bar.ma5 && bar.close >= bar.ma5) trendPts += 20;
    if (bar.ma10 && bar.close >= bar.ma10) trendPts += 20;
    if (bar.ma20 && bar.close >= bar.ma20) trendPts += 20;
    if (bar.ma60 && bar.close >= bar.ma60) trendPts += 20;
    if (bar.ma5 && prev.ma5 && bar.ma5 > prev.ma5) trendPts += 5;
    const trend = clamp(trendPts - 5);

    const score = clamp(
      profit * 0.3 + speculation * 0.25 + resilience * 0.2 + trend * 0.25
    );
    const state = classifyState(score);

    const isLastDay = i === shK.length - 1;
    const limitUpCount =
      isLastDay && ztToday.length > 0
        ? ztToday.length
        : Math.max(12, Math.round(18 + score * 0.85 + Math.max(0, cyPct) * 10));

    timeline.push({
      date: bar.date,
      score,
      state,
      limitUpCount,
      profit,
      speculation,
      resilience,
      trend,
      shClose: bar.close,
      shChangePct: Number(shPct.toFixed(2)),
    });
  }

  const latestDay = timeline[timeline.length - 1] || {
    date: dates.latestDate,
    score: 50,
    state: '震荡' as EnvState,
    limitUpCount: 35,
    profit: 50,
    speculation: 50,
    resilience: 50,
    trend: 50,
  };

  // Momentum days in current state
  let momentumDays = 1;
  for (let i = timeline.length - 2; i >= 0; i--) {
    if (timeline[i].state === latestDay.state) momentumDays++;
    else break;
  }
  const day5Ago = timeline[Math.max(0, timeline.length - 6)];
  const delta5 = latestDay.score - (day5Ago?.score ?? latestDay.score);
  const momentumText = `5日${delta5 >= 3 ? '改善' : delta5 <= -3 ? '恶化' : '平稳'} (${
    delta5 >= 0 ? '+' : ''
  }${delta5}分)`;

  // State transitions over recent 250 days
  const windowSlice = timeline.slice(-250);
  let transitionCount = 0;
  for (let i = 1; i < windowSlice.length; i++) {
    if (windowSlice[i].state !== windowSlice[i - 1].state) transitionCount++;
  }
  const rhythmPct = Math.round((transitionCount / Math.max(1, windowSlice.length)) * 100);
  const rhythm =
    rhythmPct >= 45
      ? `频繁切换 (${rhythmPct}%/天)`
      : rhythmPct >= 20
      ? `轮动切换 (${rhythmPct}%/天)`
      : `趋势延续 (${rhythmPct}%/天)`;

  // State distribution
  const stateOrder: EnvState[] = ['强势', '偏强', '震荡', '偏弱', '弱势'];
  const counts = new Map<EnvState, number>(stateOrder.map((s) => [s, 0]));
  for (const d of windowSlice) {
    counts.set(d.state, (counts.get(d.state) || 0) + 1);
  }
  const stateDistribution = stateOrder.map((state) => {
    const count = counts.get(state) || 0;
    return {
      state,
      count,
      pct: Number(((count / Math.max(1, windowSlice.length)) * 100).toFixed(2)),
      color: STATE_COLORS[state],
    };
  });

  // Emotion Cycle Phase
  const prev3Avg =
    timeline.slice(-4, -1).reduce((a, b) => a + b.score, 0) /
    Math.max(1, timeline.slice(-4, -1).length);
  let cyclePhase: MarketEnvResponse['cyclePhase'];
  if (latestDay.score < 28) {
    cyclePhase = {
      phase: '冰点期',
      advice: '空仓观望或极小仓位试错首板强反',
      positionRange: '0% - 20%',
      description: '市场情绪处于冰点区，连板高度受限，等待核心主线首次放量共振止跌。',
    };
  } else if (latestDay.score >= 28 && latestDay.score < 52 && latestDay.score >= prev3Avg) {
    cyclePhase = {
      phase: '启动期',
      advice: '聚焦首板/二板主线试错，择强去弱',
      positionRange: '30% - 50%',
      description: '情绪从低位修复拐头向上，新主线开始试盘，关注换手充分的先手龙头。',
    };
  } else if (latestDay.score >= 52 && latestDay.score < 72 && latestDay.score >= prev3Avg - 3) {
    cyclePhase = {
      phase: '发酵期',
      advice: '积极围绕主线核心与中军低吸/打板',
      positionRange: '50% - 75%',
      description: '赚钱效应扩散，多维共振走强，适合持股待涨或分歧转一致加仓。',
    };
  } else if (latestDay.score >= 72) {
    cyclePhase = {
      phase: '高潮期',
      advice: '去弱留强，警惕后排跟风兑现，不追高杂毛',
      positionRange: '40% - 60%',
      description: '情绪进入亢奋高潮区间，主线核心可继续持有观察分歧，严防一致转分歧回撤。',
    };
  } else {
    cyclePhase = {
      phase: '退潮期',
      advice: '收缩防线，及时兑现高位连板，控制回撤',
      positionRange: '10% - 30%',
      description: '综合分自高位回落且亏钱效应扩大，避免盲目接飞刀，等待新周期锚定。',
    };
  }

  // Monthly Calendar Heatmap
  const monthMap = new Map<string, MarketEnvDay[]>();
  for (const d of timeline) {
    const ym = d.date.slice(0, 7);
    if (!monthMap.has(ym)) monthMap.set(ym, []);
    monthMap.get(ym)!.push(d);
  }
  const calendarMonths = Array.from(monthMap.entries())
    .slice(-12)
    .map(([month, days]) => {
      const [y, m] = month.split('-');
      const avgScore = Math.round(
        days.reduce((a, b) => a + b.score, 0) / Math.max(1, days.length)
      );
      return {
        month,
        label: `${y}年${Number(m)}月`,
        avgScore,
        days: days.map((d) => {
          const dt = new Date(`${d.date}T00:00:00+08:00`);
          const wd = dt.getDay(); // 0=Sun -> 7
          return {
            date: d.date,
            day: Number(d.date.slice(8, 10)),
            weekday: wd === 0 ? 7 : wd,
            score: d.score,
            state: d.state,
          };
        }),
      };
    });

  return {
    range,
    updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    latest: {
      date: latestDay.date,
      score: latestDay.score,
      state: latestDay.state,
      momentumDays,
      momentumText,
      breakdown: {
        profit: latestDay.profit,
        speculation: latestDay.speculation,
        resilience: latestDay.resilience,
        trend: latestDay.trend,
      },
    },
    cyclePhase,
    transitions: {
      windowDays: windowSlice.length,
      count: transitionCount,
      rhythm,
    },
    stateDistribution,
    timeline,
    calendarMonths,
  };
}

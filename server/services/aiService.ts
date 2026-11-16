import type { AiChatMessage, AiChatResponse } from '../../src/types/market';
import { getDashboardData } from './dashboardService';
import { getStoredAiConfig } from './storageService';

export async function chatWithAi(
  messages: AiChatMessage[],
  clientContext?: Record<string, any>
): Promise<AiChatResponse> {
  const cfg = getStoredAiConfig();
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '请帮我总结当前市场状态与短线机会';

  // Always ground the AI response in real live A-share market data
  const dash = await getDashboardData().catch(() => null);
  const liveBrief = dash
    ? `当前交易日: ${dash.resolvedDate} (${dash.isMarketOpen ? '盘中交易' : '盘后复盘'})
指数: ${dash.indices.map((i) => `${i.name} ${i.price} (${i.changePct >= 0 ? '+' : ''}${i.changePct}%)`).join(' | ')}
市场温度: ${dash.temperature.score}分 (${dash.temperature.label}) | 上涨率 ${dash.breadth.upRate}% (涨${dash.breadth.up}/平${dash.breadth.flat}/跌${dash.breadth.down})
涨跌停: 涨停 ${dash.breadth.limitUp}只 (封板率${dash.breadth.sealRate}%) / 炸板 ${dash.breadth.brokenCount}只 / 跌停 ${dash.breadth.limitDown}只 / 最高 ${dash.breadth.maxStreak}板 (${dash.breadth.maxStreakStocks.map((s) => s.name).join('、')})
总成交额: ${(dash.breadth.totalAmount / 1e12).toFixed(2)}万亿 | 平均涨跌 ${dash.breadth.avgChangePct}% | 承接判断: ${dash.undertake.status}
领涨概念Top3: ${dash.conceptHot.leading.slice(0, 3).map((c) => `${c.name}(${c.changePct >= 0 ? '+' : ''}${c.changePct}%)`).join('、')}
领涨行业Top3: ${dash.industryHot.leading.slice(0, 3).map((c) => `${c.name}(${c.changePct >= 0 ? '+' : ''}${c.changePct}%)`).join('、')}`
    : '市场数据正在同步中';

  if (cfg.apiKey && cfg.apiKey.length > 6) {
    try {
      const endpoint = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const modelName = cfg.model === 'deepseek-flash' ? 'deepseek-chat' : cfg.model;
      const systemPrompt = `你是 TICK STOCK PANEL Pro (天才交易员量化交易终端 v1.2.1-enterprise) 的 A股量化与游资实战 AI 赛博研究员。
请严格遵循 A股 **红涨绿跌** 和 **T+1** 规则，基于以下实时实盘数据回答，禁止编造价格或涨跌幅：

${liveBrief}
${clientContext ? `\n当前前端上下文: ${JSON.stringify(clientContext).slice(0, 1200)}` : ''}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.slice(-10),
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const json: any = await res.json();
        const reply = json?.choices?.[0]?.message?.content;
        if (reply) {
          return {
            reply,
            model: cfg.model,
            usedFallback: false,
            timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          };
        }
      }
    } catch {
      // fall through to local quantitative engine
    }
  }

  // Rich local data-grounded quantitative analyst fallback
  const positionAdvice = !dash
    ? '建议保持轻仓观察'
    : dash.temperature.score >= 70
    ? '仓位建议 50%-70%，聚焦主线前排核心，防高潮分歧'
    : dash.temperature.score >= 50
    ? '仓位建议 40%-55%，围绕领涨方向做分歧低吸或二板确认'
    : dash.temperature.score >= 32
    ? '仓位建议 20%-35%，偏谨慎防御，控制回撤为主'
    : '仓位建议 0%-20%，市场偏冰点/弱势，耐心等待放量止跌信号';

  const reply = dash
    ? `### 📊 实盘定量研判 (${dash.resolvedDate})
> 提示：当前未配置外部 LLM API Key（可在右上角设置中填写 DeepSeek / OpenAI 兼容密钥），以下由**本地实盘量化引擎**基于最新行情实时生成。

**1. 大盘与承接状态**
- **主要指数**：${dash.indices.map((i) => `${i.name} \`${i.price}\` (${i.changePct >= 0 ? '+' : ''}${i.changePct}%)`).join(' · ')}
- **情绪温度**：**${dash.temperature.score}分 (${dash.temperature.label})** · 承接判断：**${dash.undertake.status}**
- **市场广度**：上涨 ${dash.breadth.up} 只 / 下跌 ${dash.breadth.down} 只（上涨率 **${dash.breadth.upRate}%**），两市成交额 **${(dash.breadth.totalAmount / 1e12).toFixed(2)}万亿**。

**2. 连板与主线结构**
- **涨跌停生态**：涨停 **${dash.breadth.limitUp}只**（封板率 ${dash.breadth.sealRate}%）/ 炸板 ${dash.breadth.brokenCount}只 / 跌停 ${dash.breadth.limitDown}只。
- **最高连板**：**${dash.breadth.maxStreak}板**（${dash.breadth.maxStreakStocks.map((s) => `${s.name}(${s.code})`).join('、') || '无'}）。
- **领涨概念**：${dash.conceptHot.leading.slice(0, 3).map((c) => `**${c.name}**(${c.changePct >= 0 ? '+' : ''}${c.changePct}%)`).join('、')}。
- **领涨行业**：${dash.industryHot.leading.slice(0, 3).map((c) => `**${c.name}**(${c.changePct >= 0 ? '+' : ''}${c.changePct}%)`).join('、')}。

**3. 针对「${lastUserMsg.slice(0, 40)}」的策略建议**
- **仓位纪律**：${positionAdvice}。
- **T+1 实操锚点**：重点跟踪 \`${dash.conceptHot.leading[0]?.name || '主线板块'}\` 中换手率 5%-18% 且量比 > 1.3 的容量核心，回避高位炸板率偏高的后排跟风品种。`
    : '本地量化引擎正在等待行情数据就绪，请稍后重试。';

  return {
    reply,
    model: `${cfg.model} (本地定量引擎)`,
    usedFallback: true,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
}

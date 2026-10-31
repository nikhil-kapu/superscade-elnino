// Research agent: You.com facts for the top-priority district. Cheap: once per run.
import type { AgentNode, LngLat } from '../../shared/types.ts';
import { emit } from '../bus.ts';
import { MODELS } from './crusoe.ts';
import { youSearch } from './youcom.ts';
import { getRegion } from '../regions/index.ts';

export interface ResearchResult { facts: { text: string; url: string }[]; mock: boolean }

export async function researchDistrict(regionId: string, districtName: string, ctx?: { runId: string; parentId: string; at?: LngLat; districtId?: string }): Promise<ResearchResult> {
  const region = getRegion(regionId);
  const headline = region.triggers[0]?.kind;
  const hazardWord = headline === 'rain' ? 'flood landslide' : headline === 'fire' ? 'wildfire' : 'earthquake liquefaction';
  const query = `${districtName} ${region.name} hospitals shelters emergency capacity ${hazardWord}`;
  const id = ctx ? `r-${ctx.districtId ?? districtName}-${ctx.runId}` : `r-${districtName}`;
  const at: LngLat = ctx?.at ?? region.center;
  if (ctx) {
    const node: AgentNode = { id, parentId: ctx.parentId, role: 'research', model: MODELS.research, label: `Research: ${districtName}`, districtId: ctx.districtId, at: { lng: at.lng + 0.04, lat: at.lat - 0.03 }, status: 'spawning', depth: 1 };
    emit({ type: 'agent.spawn', runId: ctx.runId, agent: node });
    emit({ type: 'agent.status', runId: ctx.runId, agentId: id, status: 'thinking', note: `you.com: ${query}` });
  }
  const t0 = Date.now();
  let result: ResearchResult;
  try {
    const { hits, mock } = await youSearch(query, 3);
    result = { mock, facts: hits.map(h => ({ text: `${h.title}: ${h.snippet}`.slice(0, 220), url: h.url })) };
  } catch (e: any) {
    result = { mock: true, facts: [{ text: `research unavailable: ${e.message}`, url: '' }] };
  }
  emit({ type: 'log', level: 'info', text: `[research${result.mock ? ' mock' : ''}] ${districtName}: ${result.facts.length} facts in ${Date.now() - t0}ms` });
  for (const f of result.facts) emit({ type: 'memory.update', key: ctx?.districtId ?? districtName, value: f.url ? `${f.text} (${f.url})` : f.text });
  if (ctx) emit({ type: 'agent.status', runId: ctx.runId, agentId: id, status: 'done', note: result.facts.map(f => f.text).join(' | ').slice(0, 300), tokens: 0 });
  return result;
}

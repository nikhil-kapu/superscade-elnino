import type { RegionConfig, RegionId } from '../../shared/types.ts';
import { bayarea } from './bayarea.ts';
import { nepal } from './nepal.ts';
import { sanfrancisco } from './sanfrancisco.ts';
export const regions: Record<RegionId, RegionConfig> = { bayarea, sanfrancisco, nepal }; // dropdown order: Bay Area El Niño (default), SF El Niño, Nepal
export function getRegion(id: string): RegionConfig { const r = regions[id as RegionId]; if (!r) throw new Error('unknown region ' + id); return r; }

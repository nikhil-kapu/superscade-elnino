// You.com Search API wrapper with mock fallback. Endpoint verified: GET https://api.you.com/v1/search?query=&count= (X-API-Key).
export interface SearchHit { title: string; url: string; snippet: string }

export function isYouMock(): boolean { return !process.env.YDC_API_KEY; }

export async function youSearch(query: string, count = 3): Promise<{ hits: SearchHit[]; mock: boolean }> {
  if (isYouMock()) {
    await new Promise(r => setTimeout(r, 350));
    return { mock: true, hits: mockHits(query).slice(0, count) };
  }
  const url = `https://api.you.com/v1/search?query=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { 'X-API-Key': process.env.YDC_API_KEY! } });
  if (!res.ok) throw new Error(`you.com ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return { mock: false, hits: normalize(await res.json()).slice(0, count) };
}

function normalize(json: any): SearchHit[] {
  const web: any[] = json?.results?.web ?? json?.hits ?? json?.web ?? [];
  return web.map((h: any) => ({
    title: h.title ?? h.name ?? 'untitled',
    url: h.url ?? '',
    snippet: Array.isArray(h.snippets) ? h.snippets[0] : (h.snippet ?? h.description ?? ''),
  })).filter(h => h.url);
}

function mockHits(query: string): SearchHit[] {
  const q = query.toLowerCase();
  if (q.includes('nepal') || q.includes('kathmandu') || q.includes('sindhupalchok')) {
    return [
      { title: 'Nepal 2015 Gorkha earthquake: landslide and flood cascades', url: 'https://en.wikipedia.org/wiki/April_2015_Nepal_earthquake', snippet: 'Sindhupalchok district recorded the highest death toll; landslides blocked the Araniko Highway and dammed rivers.' },
      { title: 'Monsoon flood preparedness - Nepal DRR portal', url: 'https://bipadportal.gov.np/', snippet: 'Government early-warning portal for flood and landslide alerts; shelter lists per district.' },
      { title: 'Tribhuvan International Airport capacity', url: 'https://en.wikipedia.org/wiki/Tribhuvan_International_Airport', snippet: 'Single runway; in 2015 relief flights were constrained by apron capacity (mock summary).' },
    ];
  }
  if (q.includes('san francisco') && !q.includes('bay area')) {
    return [
      { title: '1906 San Francisco earthquake and fire', url: 'https://earthquake.usgs.gov/earthquakes/events/1906calif/18april/', snippet: 'M7.9 San Andreas rupture; broken mains left no water, fire destroyed ~80% of the city over three days.' },
      { title: 'CGS liquefaction zones: Marina, SoMa, Treasure Island, Hunters Point', url: 'https://www.conservation.ca.gov/cgs/sh/program', snippet: 'Bay-fill neighbourhoods are mapped as very high liquefaction susceptibility; 1989 Marina collapses and fire.' },
      { title: 'SF Lifelines Council: bridges, BART tube and water', url: 'https://sfpuc.org/', snippet: 'Bay Bridge, Golden Gate and the Transbay Tube are the fixed exits; AWSS high-pressure system and cisterns for firefighting.' },
    ];
  }
  return [
    { title: 'Bay Area hospitals seismic compliance (OSHPD/HCAI)', url: 'https://hcai.ca.gov/facilities/building-safety/seismic-compliance/', snippet: 'California requires acute-care hospitals to meet seismic standards; several Oakland/SF facilities retrofitted.' },
    { title: 'USGS HayWired scenario: M7.0 on the Hayward Fault', url: 'https://www.usgs.gov/programs/earthquake-hazards/science/haywired-scenario', snippet: 'Modeled ~800 deaths and widespread fire following earthquake; East Bay water outages for weeks.' },
    { title: 'Caltrans Bay Bridge seismic retrofit', url: 'https://dot.ca.gov/programs/engineering-services/seismic', snippet: 'Bridges remain the chokepoints for cross-bay evacuation; ferries served as backup after 1989 Loma Prieta.' },
  ];
}

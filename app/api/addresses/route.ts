export const dynamic = "force-dynamic";

const VICMAP_QUERY = "https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/Vicmap_Address/FeatureServer/0/query";

type VicmapFeature = {
  attributes?: {
    ezi_address?: string | null;
    num_road_address?: string | null;
    locality_name?: string | null;
    state?: string | null;
    postcode?: string | null;
  };
};

const cleanQuery = (value: string) => value
  .trim()
  .replace(/[%_]/g, " ")
  .replace(/\s+/g, " ")
  .slice(0, 80);

const titleCase = (value: string) => value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

function formatVicmapAddress(feature: VicmapFeature): string | null {
  const item = feature.attributes;
  if (!item) return null;
  const street = item.num_road_address?.trim();
  const locality = item.locality_name?.trim();
  const postcode = item.postcode?.trim();
  if (street && locality) return `${titleCase(street)}, ${titleCase(locality)} VIC ${postcode ?? ""}`.trim();
  return item.ezi_address ? titleCase(item.ezi_address.trim()) : null;
}

async function queryVicmap(query: string, signal: AbortSignal): Promise<string[]> {
  const normalized = query.toUpperCase();
  const numbered = normalized.match(/^(\d+)\s+([A-Z][A-Z'-]*)/);
  const firstWord = normalized.match(/[A-Z][A-Z'-]*/)?.[0];
  const where = numbered
    ? `house_number_1 = ${Number(numbered[1])} AND road_name LIKE '${numbered[2].replaceAll("'", "''")}%'`
    : `road_name LIKE '${(firstWord ?? normalized).replaceAll("'", "''")}%'`;
  const params = new URLSearchParams({
    f: "json",
    where,
    outFields: "ezi_address,num_road_address,locality_name,state,postcode",
    returnGeometry: "false",
    resultRecordCount: "30",
  });
  const response = await fetch(`${VICMAP_QUERY}?${params}`, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Vicmap address search unavailable");
  const data = await response.json() as { features?: VicmapFeature[] };
  const tokens = normalized.split(" ").filter(Boolean);
  return (data.features ?? [])
    .map(formatVicmapAddress)
    .filter((address): address is string => Boolean(address))
    .filter((address) => tokens.every((token) => address.toUpperCase().includes(token)));
}

export async function GET(request: Request) {
  const query = cleanQuery(new URL(request.url).searchParams.get("q") ?? "");
  if (query.length < 3) return Response.json({ addresses: [] });

  const timedQuery = async (search: (signal: AbortSignal) => Promise<string[]>, milliseconds: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), milliseconds);
    try { return await search(controller.signal); }
    catch { return []; }
    finally { clearTimeout(timeout); }
  };

  const addresses = await timedQuery((signal) => queryVicmap(query, signal), 5000);
  return Response.json({ addresses: [...new Set(addresses)].slice(0, 8) });
}

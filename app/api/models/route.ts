import {
  modelCatalogueUrl,
  parseModelFacts,
} from "@/lib/classification/model-facts";

export async function GET() {
  try {
    const response = await fetch(modelCatalogueUrl, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Catalogue request failed.");
    return Response.json({
      models: parseModelFacts(await response.json()),
      source: modelCatalogueUrl,
    });
  } catch {
    return Response.json(
      { error: "Model stats are unavailable. You can still run the demo." },
      { status: 502 },
    );
  }
}

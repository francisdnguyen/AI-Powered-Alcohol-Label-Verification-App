import type { ApplicationData } from "./matcher";

/**
 * Mock COLA-style application records — the agent's review queue. In production these would come
 * from TTB's COLA system (swap this module for a real adapter); for the prototype they're an
 * in-memory seed. Each record carries the submitted application data plus a label image so an agent
 * can open it and verify the label against the filing. Some labels intentionally diverge from the
 * application (producer wording, country phrasing, a wrong ABV, a missing warning) so the queue
 * shows a realistic spread of clean passes, review flags, and likely rejections once verified.
 */
export type BeverageCategory = "Spirits" | "Wine" | "Beer";

export interface Application extends ApplicationData {
  id: string;
  ttbId: string;
  /** Human product/fanciful name shown in the queue (distinct from the brand). */
  productName: string;
  category: BeverageCategory;
  priority: "high" | "normal";
  /** Public path to the submitted label image. */
  labelImage: string;
  brandName: string;
  classType: string;
  alcoholContent: string;
  netContents: string;
  producerNameAddress: string;
  countryOfOrigin: string;
}

export const APPLICATIONS: Application[] = [
  {
    id: "app-silver-creek",
    ttbId: "COLA-26-018842",
    productName: "Silver Creek Straight Bourbon",
    category: "Spirits",
    priority: "normal",
    labelImage: "/labels/silver-creek.png",
    brandName: "Silver Creek",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "40% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: "Silver Creek Distillers, Frankfort, KY",
    countryOfOrigin: "USA",
  },
  {
    id: "app-meridian-ridge",
    ttbId: "COLA-26-020115",
    productName: "Meridian Ridge Cabernet Sauvignon",
    category: "Wine",
    priority: "normal",
    labelImage: "/labels/meridian-ridge.png",
    brandName: "Meridian Ridge",
    classType: "Cabernet Sauvignon",
    alcoholContent: "13.5% ABV",
    netContents: "750 mL",
    producerNameAddress: "Meridian Ridge Winery, Napa, CA",
    countryOfOrigin: "USA",
  },
  {
    id: "app-harbor-lager",
    ttbId: "COLA-26-021990",
    productName: "Harbor Light Lager",
    category: "Beer",
    priority: "normal",
    labelImage: "/labels/harbor-lager.png",
    brandName: "Harbor Light Lager",
    classType: "Lager Beer",
    alcoholContent: "4.8% ALC/VOL",
    netContents: "355 mL",
    producerNameAddress: "Harbor Brewing Co., Portland, ME",
    countryOfOrigin: "USA",
  },
  {
    id: "app-chateau-lumiere",
    ttbId: "COLA-26-022476",
    productName: "Chateau Lumiere Brut",
    category: "Wine",
    priority: "high",
    labelImage: "/labels/chateau-lumiere.png",
    brandName: "Chateau Lumiere",
    classType: "Champagne",
    alcoholContent: "12% ABV",
    netContents: "750 mL",
    producerNameAddress: "Chateau Lumiere, Reims, France",
    countryOfOrigin: "Product of France",
  },
  {
    id: "app-old-anchor-gin",
    ttbId: "COLA-26-023301",
    productName: "Old Anchor London Dry",
    category: "Spirits",
    priority: "normal",
    labelImage: "/labels/old-anchor-gin.png",
    brandName: "Old Anchor",
    classType: "London Dry Gin",
    alcoholContent: "47% ALC/VOL",
    netContents: "1 L",
    producerNameAddress: "Old Anchor Distilling, Seattle, WA",
    countryOfOrigin: "USA",
  },
  {
    id: "app-sol-dorado",
    ttbId: "COLA-26-024118",
    productName: "Sol Dorado Reposado",
    category: "Spirits",
    priority: "high",
    labelImage: "/labels/sol-dorado.png",
    brandName: "Sol Dorado",
    classType: "Tequila Reposado",
    alcoholContent: "38% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: "Destileria Sol Dorado, Jalisco, Mexico",
    countryOfOrigin: "Product of Mexico",
  },
  {
    id: "app-birchwood-rye",
    ttbId: "COLA-26-024550",
    productName: "Birchwood Straight Rye",
    category: "Spirits",
    priority: "normal",
    labelImage: "/labels/birchwood-rye.png",
    brandName: "Birchwood",
    classType: "Straight Rye Whiskey",
    alcoholContent: "45% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: "Birchwood Distillery, Bardstown, KY",
    countryOfOrigin: "USA",
  },
  {
    id: "app-costa-verde",
    ttbId: "COLA-26-025012",
    productName: "Costa Verde Sauvignon Blanc",
    category: "Wine",
    priority: "normal",
    labelImage: "/labels/costa-verde.png",
    brandName: "Costa Verde",
    classType: "Sauvignon Blanc",
    alcoholContent: "12.5% ABV",
    netContents: "750 mL",
    producerNameAddress: "Costa Verde Vineyards, Marlborough, New Zealand",
    countryOfOrigin: "Product of New Zealand",
  },
  {
    id: "app-ironclad-ipa",
    ttbId: "COLA-26-025744",
    productName: "Ironclad IPA",
    category: "Beer",
    priority: "normal",
    labelImage: "/labels/ironclad-ipa.png",
    brandName: "Ironclad",
    classType: "India Pale Ale",
    alcoholContent: "6.5% ALC/VOL",
    netContents: "473 mL",
    producerNameAddress: "Ironclad Brewing Co., Richmond, VA",
    countryOfOrigin: "USA",
  },
  {
    id: "app-vasco-porto",
    ttbId: "COLA-26-026318",
    productName: "Vasco Tawny Port",
    category: "Wine",
    priority: "high",
    labelImage: "/labels/vasco-porto.png",
    brandName: "Vasco",
    classType: "Tawny Port",
    alcoholContent: "20% ABV",
    netContents: "750 mL",
    producerNameAddress: "Quinta do Vasco, Douro, Portugal",
    countryOfOrigin: "Product of Portugal",
  },
  {
    id: "app-northwind-vodka",
    ttbId: "COLA-26-026902",
    productName: "Northwind Vodka",
    category: "Spirits",
    priority: "normal",
    labelImage: "/labels/northwind-vodka.png",
    brandName: "Northwind",
    classType: "Vodka",
    alcoholContent: "40% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: "Northwind Distilling, Minneapolis, MN",
    countryOfOrigin: "USA",
  },
  {
    id: "app-sunset-rose",
    ttbId: "COLA-26-027455",
    productName: "Sunset Coast Rosé",
    category: "Wine",
    priority: "normal",
    labelImage: "/labels/sunset-rose.png",
    brandName: "Sunset Coast",
    classType: "Rosé",
    alcoholContent: "11.5% ABV",
    netContents: "750 mL",
    producerNameAddress: "Sunset Coast Cellars, Paso Robles, CA",
    countryOfOrigin: "USA",
  },
];

export function getApplication(id: string): Application | undefined {
  return APPLICATIONS.find((a) => a.id === id);
}

/**
 * Queue rows for the console — the fields shown in the worklist table (no heavy payload). Carries
 * `labelImage` so the queue can bulk-verify: the browser fetches each label and uploads it (the same
 * client-fetch path single review uses, which keeps us off the serverless filesystem on Vercel).
 */
export function listApplications() {
  return APPLICATIONS.map(
    ({ id, ttbId, brandName, productName, category, classType, alcoholContent, priority, labelImage }) => ({
      id,
      ttbId,
      brandName,
      productName,
      category,
      classType,
      alcoholContent,
      priority,
      labelImage,
    }),
  );
}

export type ApplicationSummary = ReturnType<typeof listApplications>[number];

import type { ApplicationData } from "./matcher";

/**
 * Mock COLA-style application records. In production these would come from TTB's
 * COLA system; for the prototype they're an in-memory seed so agents can pick an
 * application to grade a label against. Two of them intentionally match the
 * synthetic fixtures in public/labels/ so the demo shows a clean pass; others
 * exercise mismatches.
 */
export interface Application extends ApplicationData {
  id: string;
  ttbId: string;
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
    ttbId: "TTB-24-018842",
    brandName: "Silver Creek",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "40% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: "Silver Creek Distillers, Frankfort, KY",
    countryOfOrigin: "USA",
  },
  {
    id: "app-meridian-ridge",
    ttbId: "TTB-24-020115",
    brandName: "Meridian Ridge",
    classType: "Cabernet Sauvignon",
    alcoholContent: "13.5% ABV",
    netContents: "750 mL",
    producerNameAddress: "Meridian Ridge Winery, Napa, CA",
    countryOfOrigin: "USA",
  },
  {
    id: "app-harbor-lager",
    ttbId: "TTB-24-021990",
    brandName: "Harbor Light Lager",
    classType: "Lager Beer",
    alcoholContent: "4.8% ALC/VOL",
    netContents: "355 mL",
    producerNameAddress: "Harbor Brewing Co., Portland, ME",
    countryOfOrigin: "USA",
  },
  {
    id: "app-chateau-lumiere",
    ttbId: "TTB-24-022476",
    brandName: "Chateau Lumiere",
    classType: "Champagne",
    alcoholContent: "12% ABV",
    netContents: "750 mL",
    producerNameAddress: "Chateau Lumiere, Reims, France",
    countryOfOrigin: "Product of France",
  },
  {
    id: "app-old-anchor-gin",
    ttbId: "TTB-24-023301",
    brandName: "Old Anchor",
    classType: "London Dry Gin",
    alcoholContent: "47% ALC/VOL",
    netContents: "1 L",
    producerNameAddress: "Old Anchor Distilling, Seattle, WA",
    countryOfOrigin: "USA",
  },
  {
    id: "app-sol-dorado",
    ttbId: "TTB-24-024118",
    brandName: "Sol Dorado",
    classType: "Tequila Reposado",
    alcoholContent: "38% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: "Destileria Sol Dorado, Jalisco, Mexico",
    countryOfOrigin: "Product of Mexico",
  },
];

export function getApplication(id: string): Application | undefined {
  return APPLICATIONS.find((a) => a.id === id);
}

/** Fields shown when listing applications for selection (no heavy payload). */
export function listApplications() {
  return APPLICATIONS.map(({ id, ttbId, brandName, classType }) => ({
    id,
    ttbId,
    brandName,
    classType,
  }));
}

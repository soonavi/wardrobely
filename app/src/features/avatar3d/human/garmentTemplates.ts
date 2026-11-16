/**
 * Garment templates: which silhouette a wardrobe item is drawn with.
 *
 * Selv knows a garment's category, its name and its colour — not its cut. The
 * avatar asset carries a fixed set of silhouettes (built by
 * `tools/avatar-build`); this module picks one from what the garment says
 * about itself. "Black cropped hoodie" in the `top` category is a hoodie;
 * something called only "Blue" in `bottom` is jeans, because that is the least
 * surprising thing for it to be.
 *
 * A garment can also carry an explicit `template`, which always wins — that is
 * the hook for letting people correct a wrong guess.
 */

export const GARMENT_TEMPLATES = [
  "tank", "tee", "crop", "longsleeve", "shirt", "sweater", "hoodie", "jacket", "coat",
  "leggings", "jeans", "trousers", "shorts", "skirt_mini", "skirt_midi", "skirt_maxi",
  "dress_mini", "dress_midi", "dress_maxi", "sneakers", "boots", "flats",
] as const;

export type GarmentTemplateId = (typeof GARMENT_TEMPLATES)[number];

/** What a template covers, which decides what may be worn with it. */
export type TemplateCoverage = "torso" | "outer" | "legs" | "skirt" | "full" | "feet";

export const TEMPLATE_INFO: Record<GarmentTemplateId, { label: string; covers: TemplateCoverage }> = {
  tank: { label: "Tank top", covers: "torso" },
  tee: { label: "T-shirt", covers: "torso" },
  crop: { label: "Crop top", covers: "torso" },
  longsleeve: { label: "Long-sleeve top", covers: "torso" },
  shirt: { label: "Shirt", covers: "torso" },
  sweater: { label: "Sweater", covers: "torso" },
  hoodie: { label: "Hoodie", covers: "torso" },
  jacket: { label: "Jacket", covers: "outer" },
  coat: { label: "Coat", covers: "outer" },
  leggings: { label: "Leggings", covers: "legs" },
  jeans: { label: "Jeans", covers: "legs" },
  trousers: { label: "Trousers", covers: "legs" },
  shorts: { label: "Shorts", covers: "legs" },
  skirt_mini: { label: "Mini skirt", covers: "skirt" },
  skirt_midi: { label: "Midi skirt", covers: "skirt" },
  skirt_maxi: { label: "Maxi skirt", covers: "skirt" },
  dress_mini: { label: "Mini dress", covers: "full" },
  dress_midi: { label: "Midi dress", covers: "full" },
  dress_maxi: { label: "Maxi dress", covers: "full" },
  sneakers: { label: "Sneakers", covers: "feet" },
  boots: { label: "Boots", covers: "feet" },
  flats: { label: "Flats", covers: "feet" },
};

export function isGarmentTemplate(value: unknown): value is GarmentTemplateId {
  return typeof value === "string" && (GARMENT_TEMPLATES as readonly string[]).includes(value);
}

/** Name of the mesh in the avatar asset for a template. */
export function templatePartName(id: GarmentTemplateId): string {
  return `G_${id}`;
}

type Rule = [RegExp, GarmentTemplateId];

const LENGTH: { mini: RegExp; maxi: RegExp } = {
  mini: /\b(mini|short|micro|skater|bodycon)\b/,
  maxi: /\b(maxi|long|floor|gown|ankle)\b/,
};

// Checked in order; the first match wins. Outerwear words come before the
// tops they contain ("denim jacket" is a jacket, not jeans).
const TOP_RULES: Rule[] = [
  [/\b(coat|trench|parka|overcoat|peacoat|puffer|duster)\b/, "coat"],
  [/\b(jacket|blazer|bomber|windbreaker|gilet|anorak|shacket|cardigan)\b/, "jacket"],
  [/\b(hoodie|hoody|hooded|sweatshirt|crewneck sweat|fleece)\b/, "hoodie"],
  [/\b(sweater|jumper|knit|pullover|turtleneck|cashmere)\b/, "sweater"],
  [/\b(tank|cami|camisole|singlet|sleeveless|halter|vest top|tube)\b/, "tank"],
  [/\b(crop|cropped|bralette|bustier)\b/, "crop"],
  [/\b(long[- ]?sleeve|longsleeve|henley|thermal|base layer)\b/, "longsleeve"],
  // "t-shirt" before "shirt": a word boundary sits between the hyphen and the s.
  [/\b(t[- ]?shirt|tee)\b/, "tee"],
  [/\b(shirt|blouse|button|oxford|flannel|polo)\b/, "shirt"],
  [/\btop\b/, "tee"],
];

const BOTTOM_RULES: Rule[] = [
  [/\b(legging|leggings|tights|yoga)\b/, "leggings"],
  [/\b(shorts|bermuda|boardshort)\b/, "shorts"],
  [/\b(jean|jeans|denim)\b/, "jeans"],
  [/\b(trouser|trousers|pant|pants|slacks|chino|chinos|cargo|jogger|joggers|sweatpant|sweatpants|culotte|palazzo|wide[- ]?leg)\b/, "trousers"],
];

const SHOE_RULES: Rule[] = [
  [/\b(boot|boots|chelsea|combat|doc|docs|wellington)\b/, "boots"],
  [/\b(flat|flats|loafer|loafers|sandal|sandals|slide|slides|heel|heels|pump|pumps|mule|mules|ballet|espadrille|slipper)\b/, "flats"],
  [/\b(sneaker|sneakers|trainer|trainers|runner|running|kicks|high[- ]?top)\b/, "sneakers"],
];

function firstMatch(rules: Rule[], text: string): GarmentTemplateId | null {
  for (const [pattern, id] of rules) if (pattern.test(text)) return id;
  return null;
}

function byLength(text: string, prefix: "skirt" | "dress"): GarmentTemplateId {
  if (LENGTH.maxi.test(text)) return `${prefix}_maxi` as GarmentTemplateId;
  if (LENGTH.mini.test(text)) return `${prefix}_mini` as GarmentTemplateId;
  return `${prefix}_midi` as GarmentTemplateId;
}

export type TemplateQuery = {
  /** Wardrobe category: top | bottom | dress | outerwear | shoes | accessory. */
  category?: string | null;
  /** Avatar slot, when the category is not known. */
  slot?: "top" | "bottom" | "shoes" | "accessory" | "outer" | null;
  name?: string | null;
  /** Legacy flag from the primitive avatar: this top is a dress. */
  long?: boolean;
  /** Explicit choice; wins when it names a real template. */
  template?: string | null;
};

/**
 * The silhouette for a garment, or `null` when nothing in the asset can stand
 * in for it (accessories: a bag, a belt and a beanie share a category and no
 * shape).
 */
export function pickGarmentTemplate(q: TemplateQuery): GarmentTemplateId | null {
  if (isGarmentTemplate(q.template)) return q.template;
  const text = (q.name ?? "").toLowerCase();
  const category =
    q.category ??
    (q.slot === "top" ? (q.long ? "dress" : "top") : q.slot === "outer" ? "outerwear" : q.slot ?? null);

  switch (category) {
    case "dress":
      return byLength(text, "dress");
    case "outerwear": {
      const hit = firstMatch(TOP_RULES, text);
      if (hit === "coat" || hit === "jacket" || hit === "hoodie") return hit;
      return "jacket";
    }
    case "top": {
      if (/\b(dress|gown)\b/.test(text)) return byLength(text, "dress");
      const hit = firstMatch(TOP_RULES, text);
      // A coat filed under "top" is still drawn as one; it just occupies the top slot.
      return hit ?? "tee";
    }
    case "bottom":
      if (/\bskirt\b/.test(text)) return byLength(text, "skirt");
      return firstMatch(BOTTOM_RULES, text) ?? "jeans";
    case "shoes":
      return firstMatch(SHOE_RULES, text) ?? "sneakers";
    default:
      return null;
  }
}

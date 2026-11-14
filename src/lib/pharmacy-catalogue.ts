/* Pure catalogue-scoping helpers shared by the pharmacy console and tests.
   No browser or React imports — safe to load under `node --test`. */

/** Mirrors pharmacy-data's DEFAULT_STORE_ID for legacy rows without a store. */
const LEGACY_STORE_ID = "st-main";

type CatalogueName = { name: string };
type ShelfName = { name: string; storeId?: string };

/** Product names compare without case or surrounding whitespace. */
export function normaliseProductName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Finds the catalogue record for a product name, if it exists. */
export function findCatalogueProductByName<T extends CatalogueName>(
  products: readonly T[],
  name: string
): T | undefined {
  const target = normaliseProductName(name);
  if (!target) return undefined;
  return products.find((product) => normaliseProductName(product.name) === target);
}

/**
 * Whether a product name is already stocked in a store. Catalogue products are
 * global; their stock lives per store, so duplicates are scoped to shelves
 * rather than to the whole catalogue.
 */
export function storeHasProduct(
  storeId: string | null | undefined,
  name: string,
  items: readonly ShelfName[],
  legacyStoreId = LEGACY_STORE_ID
): boolean {
  const target = normaliseProductName(name);
  if (!storeId || !target) return false;
  return items.some(
    (item) =>
      (item.storeId ?? legacyStoreId) === storeId &&
      normaliseProductName(item.name) === target
  );
}

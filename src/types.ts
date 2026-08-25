export const ITEM_TYPES = [
  "login",
  "note",
  "card",
  "passkey",
  "contact",
  "document",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export function isItemType(value: string): value is ItemType {
  return ITEM_TYPES.includes(value as ItemType);
}

export type Session = {
  userId: string;
  email: string;
};

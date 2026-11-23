import { getStore } from "@netlify/blobs";

// Private object storage (Netlify Blobs). Nothing here is reachable by URL; downloads go through
// the authenticated API only.
const store = () => getStore({ name: "rams-uploads", consistency: "strong" });

export const stagingKey = (token: string) => `staging/${token}`;
export const evidenceKey = (token: string) => `evidence/${token}`;

export async function putFile(key: string, data: ArrayBuffer, metadata: Record<string, unknown>) {
  await store().set(key, data, { metadata });
}
export async function getFile(key: string): Promise<{ data: ArrayBuffer; metadata: Record<string, any> } | null> {
  const r = await store().getWithMetadata(key, { type: "arrayBuffer" });
  return r ? { data: r.data as ArrayBuffer, metadata: (r.metadata ?? {}) as Record<string, any> } : null;
}
export async function deleteFile(key: string) {
  try {
    await store().delete(key);
  } catch {
    /* best effort */
  }
}

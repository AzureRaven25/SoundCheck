'use server';
import { revalidatePath } from 'next/cache';

/** After songs were added to an artist (fetched on demand), rebuild their cached page. */
export async function refreshArtist(id: string) {
  if (/^[0-9a-f-]{36}$/i.test(id)) revalidatePath(`/artist/${id}`);
}

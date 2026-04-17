import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
  const query = url.searchParams.toString();
  throw redirect(307, `/spaces/${params.id}${query ? `?${query}` : ''}`);
};

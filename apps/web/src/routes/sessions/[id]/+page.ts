import { redirect } from '@sveltejs/kit';
import { getSession } from '$lib/api';

export const load = async ({ params, fetch }) => {
  try {
    const session = await getSession(params.id, fetch);
    return {
      session
    };
  } catch {
    throw redirect(302, '/login');
  }
};

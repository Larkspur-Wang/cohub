import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const TOKEN_KEY = 'neta-token';

// Initial value from localStorage
const initialToken = browser ? localStorage.getItem(TOKEN_KEY) : null;

export const token = writable<string | null>(initialToken);

// Subscribe to changes and update localStorage
if (browser) {
    token.subscribe((value) => {
        if (value) {
            localStorage.setItem(TOKEN_KEY, value);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }
    });
}

export function logout() {
    token.set(null);
}


import { fetchWithAuth } from './auth.js';

const API = '/api';

export async function getProfile(id) {
  const res = await fetch(`${API}/users/${id}`);
  if (!res.ok) throw new Error('Profile not found');
  return res.json();
}

export async function updateProfile(id, patch) {
  const res = await fetchWithAuth(`${API}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error('Update failed');
  return res.json();
}
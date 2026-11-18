/** What the sender hears when 4VD didn't take the mail (only then). */
export async function rejectReason(response) {
  let code = null;
  try {
    code = (await response.json())?.error ?? null;
  } catch {
    // Not JSON (a proxy error page): treat it as "try again".
  }
  if (response.status === 404 && code === 'UNKNOWN_BILL_ADDRESS') {
    return 'No 4VD business uses this address. Check the address the shop gave you.';
  }
  return '4VD could not take this bill just now. Please send it again in a few minutes.';
}

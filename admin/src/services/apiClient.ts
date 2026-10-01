/** Shape every backend endpoint returns, see docs/API.md. */
export interface ApiResponse<TData> {
  success: boolean;
  data: TData | null;
  message: string;
  error: string | null;
  meta?: { page: number; total: number; limit: number };
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function request<TData>(path: string, init?: RequestInit): Promise<TData> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = (await response.json()) as ApiResponse<TData>;

  if (!response.ok || !body.success || body.data === null) {
    throw new Error(body.message || `Request failed with status ${response.status}`);
  }
  return body.data;
}

export const apiClient = {
  getHealth: () => request<HealthStatus>('/health'),
};

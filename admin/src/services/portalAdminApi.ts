import { apiRequest } from './apiClient';
import type { PortalLanguage, PortalOrder, PortalOrderLine } from './portalApi';

/** The shop's side of the business customers' portal (step 15). */

export interface ShopPortalPerson {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  language: PortalLanguage;
  lastSeenAt: string | null;
  invitePending: boolean;
}

export interface ShopPortal {
  customerId: number;
  enabled: boolean;
  canOrder: boolean;
  minOrder: number | null;
  categories: number[] | null;
  people: ShopPortalPerson[];
  allCategories: Array<{ id: number; name: string }>;
}

export type ShopPortalOrderStatus = 'sent' | 'seen' | 'accepted' | 'declined' | 'cancelled';

export interface ShopPortalOrder extends PortalOrder {
  status: ShopPortalOrderStatus;
  customer: { id: number; name: string };
  offerId: number | null;
}

export interface ShopPortalOrderDetail extends ShopPortalOrder {
  lines: PortalOrderLine[];
}

export const portalAdminApi = {
  settings: async (customerId: number) => (await apiRequest<ShopPortal>(`/portal-admin/customers/${customerId}`)).data,
  save: async (customerId: number, input: { enabled: boolean; canOrder: boolean; minOrder: number | null; categories: number[] | null }) =>
    (await apiRequest<ShopPortal>(`/portal-admin/customers/${customerId}`, { method: 'PUT', body: input })).data,
  invite: async (customerId: number, input: { name: string; email: string | null; phone: string | null; language: PortalLanguage; sendEmail: boolean }) =>
    (await apiRequest<{ person: ShopPortalPerson; link: string; emailed: boolean }>(`/portal-admin/customers/${customerId}/people`, { method: 'POST', body: input })).data,
  newLink: async (customerId: number, personId: number, sendEmail: boolean) =>
    (await apiRequest<{ link: string; emailed: boolean }>(`/portal-admin/customers/${customerId}/people/${personId}/link`, { method: 'POST', body: { sendEmail } })).data,
  remove: async (customerId: number, personId: number) => {
    await apiRequest<null>(`/portal-admin/customers/${customerId}/people/${personId}`, { method: 'DELETE' });
  },
  signOutAll: async (customerId: number) => {
    await apiRequest<null>(`/portal-admin/customers/${customerId}/sign-out`, { method: 'POST' });
  },
  orders: async (customerId?: number) => (await apiRequest<ShopPortalOrder[]>('/portal-admin/orders', { query: { customerId } })).data,
  order: async (id: number) => (await apiRequest<ShopPortalOrderDetail>(`/portal-admin/orders/${id}`)).data,
  accept: async (id: number) => (await apiRequest<{ order: ShopPortalOrderDetail; offer: { id: number; number: string } }>(`/portal-admin/orders/${id}/accept`, { method: 'POST' })).data,
  decline: async (id: number, reason: string | null) => (await apiRequest<ShopPortalOrderDetail>(`/portal-admin/orders/${id}/decline`, { method: 'POST', body: { reason } })).data,
};

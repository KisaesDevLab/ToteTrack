import type {
  AppSettings,
  AuthStatus,
  BoxCreateInput,
  BoxDetail,
  BoxListQuery,
  BoxSummary,
  BoxUpdateInput,
  Item,
  ItemCreateInput,
  ItemUpdateInput,
  LabelPdfInput,
  LabelTemplate,
  Location,
  LocationCreateInput,
  LocationUpdateInput,
  Photo,
  SearchResult,
  Series,
  SeriesCreateInput,
  SeriesUpdateInput,
  SettingsUpdateInput,
} from '@totetrack/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api, del, download, get, patch, post, put } from './client';

// --- keys --------------------------------------------------------------------

export const keys = {
  auth: ['auth'] as const,
  settings: ['settings'] as const,
  series: ['series'] as const,
  locations: ['locations'] as const,
  boxes: (q?: Partial<BoxListQuery>) => ['boxes', q ?? {}] as const,
  box: (id: number) => ['box', id] as const,
  boxByLabel: (label: string) => ['box-by-label', label] as const,
  search: (q: string, locationId?: number, status?: string) =>
    ['search', q, locationId ?? null, status ?? null] as const,
  templates: ['label-templates'] as const,
};

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// --- auth --------------------------------------------------------------------

export function useAuthStatus() {
  return useQuery({
    queryKey: keys.auth,
    queryFn: () => api<AuthStatus>('/api/auth/status', { silent401: true }),
    staleTime: 30_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      await api('/api/auth/login', { method: 'POST', body: { pin }, silent401: true });
      // Wait for the auth state to flip before callers navigate, so the guarded routes render.
      await qc.refetchQueries({ queryKey: keys.auth });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pin: string) => {
      await api('/api/auth/setup', { method: 'POST', body: { pin }, silent401: true });
      await qc.refetchQueries({ queryKey: keys.auth });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/api/auth/logout'),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries({ queryKey: keys.auth });
    },
  });
}

export function useChangePin() {
  return useMutation({
    mutationFn: (body: { currentPin: string; newPin: string }) =>
      api('/api/auth/change-pin', { method: 'POST', body, silent401: true }),
  });
}

// --- settings ----------------------------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => get<AppSettings>('/api/settings'),
    staleTime: 30_000,
    // Poll while the tunnel connector is coming up so the status pill turns green on its own.
    refetchInterval: (q) => (q.state.data?.tunnel.state === 'starting' ? 2_000 : false),
  });
}

export function useRestartTunnel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<AppSettings>('/api/settings/tunnel/restart'),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdateInput) => patch<AppSettings>('/api/settings', body),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

// --- series ------------------------------------------------------------------

export function useSeries() {
  return useQuery({
    queryKey: keys.series,
    queryFn: () => get<Series[]>('/api/series'),
    staleTime: 60_000,
  });
}

export function useCreateSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeriesCreateInput) => post<Series>('/api/series', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.series }),
  });
}

export function useUpdateSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SeriesUpdateInput & { id: number }) =>
      patch<Series>(`/api/series/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.series }),
  });
}

export function useDeleteSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(`/api/series/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.series }),
  });
}

// --- locations ---------------------------------------------------------------

export function useLocations() {
  return useQuery({
    queryKey: keys.locations,
    queryFn: () => get<Location[]>('/api/locations'),
    staleTime: 60_000,
  });
}

function invalidateBoxy(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['boxes'] });
  void qc.invalidateQueries({ queryKey: ['box'] });
  void qc.invalidateQueries({ queryKey: ['search'] });
  void qc.invalidateQueries({ queryKey: keys.locations });
  void qc.invalidateQueries({ queryKey: keys.series });
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LocationCreateInput) => post<Location>('/api/locations', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.locations }),
  });
}

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: LocationUpdateInput & { id: number }) =>
      patch<Location>(`/api/locations/${id}`, body),
    onSuccess: () => invalidateBoxy(qc),
  });
}

export function useReorderLocations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => put('/api/locations/reorder', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.locations }),
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(`/api/locations/${id}`),
    onSuccess: () => invalidateBoxy(qc),
  });
}

// --- boxes -------------------------------------------------------------------

export function useBoxes(
  q: Partial<BoxListQuery> = {},
  options: Partial<UseQueryOptions<BoxSummary[]>> = {},
) {
  return useQuery({
    queryKey: keys.boxes(q),
    queryFn: () =>
      get<BoxSummary[]>(
        `/api/boxes${qs(q as Record<string, string | number | boolean | undefined>)}`,
      ),
    staleTime: 15_000,
    ...options,
  });
}

export function useBox(id: number | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: keys.box(id ?? 0),
    queryFn: () => get<BoxDetail>(`/api/boxes/${id}`),
    enabled: Boolean(id),
    staleTime: 5_000,
    refetchInterval: opts.refetchInterval,
  });
}

export function useBoxByLabel(label: string | undefined) {
  return useQuery({
    queryKey: keys.boxByLabel(label ?? ''),
    queryFn: () => api<BoxSummary>(`/api/boxes/by-label/${encodeURIComponent(label ?? '')}`),
    enabled: Boolean(label),
    retry: false,
  });
}

export function useCreateBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BoxCreateInput) => post<BoxSummary>('/api/boxes', body),
    onSuccess: () => invalidateBoxy(qc),
  });
}

export function useUpdateBox(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BoxUpdateInput) => patch<BoxSummary>(`/api/boxes/${id}`, body),
    onSuccess: (data) => {
      qc.setQueryData<BoxDetail | undefined>(keys.box(id), (old) =>
        old ? { ...old, ...data } : old,
      );
      invalidateBoxy(qc);
    },
  });
}

export function useToggleBoxStatus(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<BoxSummary>(`/api/boxes/${id}/toggle-status`),
    onSuccess: (data) => {
      qc.setQueryData<BoxDetail | undefined>(keys.box(id), (old) =>
        old ? { ...old, ...data } : old,
      );
      invalidateBoxy(qc);
    },
  });
}

export function useDeleteBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(`/api/boxes/${id}`),
    onSuccess: () => invalidateBoxy(qc),
  });
}

export function useAnalyzeBox(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ queued: boolean }>(`/api/boxes/${id}/analyze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.box(id) }),
  });
}

// --- photos ------------------------------------------------------------------

export interface UploadResult {
  photos: Photo[];
  aiQueued: boolean;
  box: BoxDetail;
}

export function useUploadPhotos(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData();
      for (const f of files) fd.append('photos', f, f.name || 'photo.jpg');
      return api<UploadResult>(`/api/boxes/${boxId}/photos`, { method: 'POST', formData: fd });
    },
    onSuccess: (data) => {
      qc.setQueryData(keys.box(boxId), data.box);
      invalidateBoxy(qc);
    },
  });
}

export function useReorderPhotos(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => put<Photo[]>(`/api/boxes/${boxId}/photos/reorder`, { ids }),
    onSuccess: (photos) => {
      qc.setQueryData<BoxDetail | undefined>(keys.box(boxId), (old) =>
        old ? { ...old, photos } : old,
      );
      invalidateBoxy(qc);
    },
  });
}

export function useDeletePhoto(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => del(`/api/photos/${photoId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.box(boxId) });
      invalidateBoxy(qc);
    },
  });
}

export function useAnalyzePhoto(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => post<{ queued: boolean }>(`/api/photos/${photoId}/analyze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.box(boxId) }),
  });
}

// --- items -------------------------------------------------------------------

export function useCreateItem(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCreateInput) => post<Item>(`/api/boxes/${boxId}/items`, body),
    onSuccess: (item) => {
      qc.setQueryData<BoxDetail | undefined>(keys.box(boxId), (old) =>
        old ? { ...old, items: [...old.items, item], itemCount: old.itemCount + 1 } : old,
      );
      invalidateBoxy(qc);
    },
  });
}

export function useUpdateItem(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ItemUpdateInput & { id: number }) =>
      patch<Item>(`/api/items/${id}`, body),
    onSuccess: (item) => {
      qc.setQueryData<BoxDetail | undefined>(keys.box(boxId), (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === item.id ? item : i)) } : old,
      );
      void qc.invalidateQueries({ queryKey: ['search'] });
    },
  });
}

export function useDeleteItem(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(`/api/items/${id}`),
    onSuccess: (_d, id) => {
      qc.setQueryData<BoxDetail | undefined>(keys.box(boxId), (old) =>
        old
          ? {
              ...old,
              items: old.items.filter((i) => i.id !== id),
              itemCount: Math.max(0, old.itemCount - 1),
            }
          : old,
      );
      invalidateBoxy(qc);
    },
  });
}

export function useBulkDeleteItems(boxId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source?: 'ai' | 'manual') =>
      del<{ deleted: number }>(`/api/boxes/${boxId}/items${source ? `?source=${source}` : ''}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.box(boxId) });
      invalidateBoxy(qc);
    },
  });
}

// --- search ------------------------------------------------------------------

export function useSearch(
  q: string,
  filters: { locationId?: number; status?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: keys.search(q, filters.locationId, filters.status),
    queryFn: ({ signal }) =>
      get<SearchResult[]>(
        `/api/search${qs({ q, locationId: filters.locationId, status: filters.status })}`,
        signal,
      ),
    enabled,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

// --- labels ------------------------------------------------------------------

export function useLabelTemplates() {
  return useQuery({
    queryKey: keys.templates,
    queryFn: () =>
      get<{ templates: LabelTemplate[]; defaultTemplateId: string }>('/api/labels/templates'),
    staleTime: Infinity,
  });
}

export function useDownloadLabels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LabelPdfInput) =>
      download('/api/labels/pdf', { method: 'POST', body, filename: 'totetrack-labels.pdf' }),
    onSuccess: () => invalidateBoxy(qc),
  });
}

/** Puerto: lo que `/me` cuenta para un admin de plataforma (SPEC 18). */
export interface PlatformOverview {
  /** Empresas en revisión. */
  countPendingTenants(): Promise<number>;
}

export const PLATFORM_OVERVIEW = Symbol('PLATFORM_OVERVIEW');

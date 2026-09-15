import { siteConfig } from '@arsvine/site-config';

export function getApiBaseUrl() {
  return new URL(siteConfig.api.origin);
}

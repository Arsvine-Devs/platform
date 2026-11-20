import { internalServiceUrl } from '@arsvine/site-config';

export function getApiBaseUrl() {
  return new URL(internalServiceUrl('api'));
}

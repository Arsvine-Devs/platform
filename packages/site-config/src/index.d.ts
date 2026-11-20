export type ServiceOrigins = {
  readonly realm: string;
  readonly ripple: string;
  readonly console: string;
  readonly auth: string;
  readonly api: string;
  readonly content: string;
  readonly status: string;
};

export type CatalogNamespaces = {
  readonly realmAssets: string;
  readonly ripple: string;
};

export type SiteConfig = {
  readonly realm: {
    readonly origin: string;
    readonly healthLivePath: string;
    readonly healthReadyPath: string;
  };
  readonly ripple: {
    readonly origin: string;
    readonly healthLivePath: string;
    readonly healthReadyPath: string;
    readonly musicApiPath: string;
  };
  readonly console: {
    readonly origin: string;
    readonly healthLivePath: string;
    readonly healthReadyPath: string;
    readonly oidc: {
      readonly issuer: string;
      readonly authorizationUrl: string;
      readonly tokenUrl: string;
      readonly userinfoUrl: string;
      readonly jwksUrl: string;
      readonly endSessionUrl: string;
      readonly redirectUri: string;
      readonly postLogoutRedirectUri: string;
      readonly resource: string;
      readonly scope: string;
    };
  };
  readonly auth: {
    readonly origin: string;
    readonly displayName: string;
    readonly issuer: string;
    readonly jwksUrl: string;
    readonly audience: readonly string[];
    readonly oauthResources: readonly string[];
    readonly passkeyRpId: string;
    readonly passkeyOrigin: string;
    readonly healthLivePath: string;
    readonly healthReadyPath: string;
  };
  readonly api: {
    readonly origin: string;
    readonly displayName: string;
    readonly resource: string;
    readonly healthLivePath: string;
    readonly healthReadyPath: string;
  };
  readonly content: {
    readonly origin: string;
    readonly displayName: string;
    readonly resource: string;
    readonly healthLivePath: string;
    readonly healthReadyPath: string;
  };
  readonly status: {
    readonly origin: string;
  };
};

export declare const serviceOrigins: ServiceOrigins;
export declare function internalServiceUrl(
  service: keyof ServiceOrigins,
  publicUrl?: string,
): string;
export declare const catalogNamespaces: CatalogNamespaces;
export declare const siteConfig: SiteConfig;

export type SiteConfig = {
  readonly realm: {
    readonly origin: string;
    readonly revalidateUrl: string;
  };
  readonly console: {
    readonly origin: string;
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
  };
  readonly api: {
    readonly origin: string;
    readonly displayName: string;
    readonly resource: string;
  };
  readonly content: {
    readonly origin: string;
    readonly displayName: string;
    readonly resource: string;
    readonly pointerKey: string;
    readonly publicationUrl: string;
  };
  readonly cdn: {
    readonly origin: string;
  };
};

export declare const siteConfig: SiteConfig;

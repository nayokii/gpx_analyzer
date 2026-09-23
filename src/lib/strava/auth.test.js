import { describe, it, expect, vi } from "vitest";
import {
  buildAuthorizeUrl,
  parseAuthCallback,
  assertHasActivityReadScope,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeConnection,
  isTokenExpired,
  ensureFreshTokens,
  generateOAuthState,
  REQUESTED_SCOPE,
  STRAVA_AUTHORIZE_URL,
} from "./auth.js";
import { StravaAuthDeniedError, StravaInvalidCallbackError, StravaScopeError, StravaRefreshError } from "./errors.js";

function fakeFetch(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("buildAuthorizeUrl", () => {
  it("construit l'URL d'autorisation avec les paramètres OAuth requis (voir docs Strava)", () => {
    const url = buildAuthorizeUrl({ clientId: "12345", redirectUri: "http://localhost:5173/", state: "abc" });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(STRAVA_AUTHORIZE_URL);
    expect(parsed.searchParams.get("client_id")).toBe("12345");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:5173/");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(REQUESTED_SCOPE);
    expect(parsed.searchParams.get("state")).toBe("abc");
  });

  it("ne demande jamais activity:write ni profile:write (lecture seule uniquement)", () => {
    const url = buildAuthorizeUrl({ clientId: "1", redirectUri: "http://localhost/" });
    const scope = new URL(url).searchParams.get("scope");
    expect(scope).not.toContain("write");
  });

  it("lève si clientId ou redirectUri manquent, plutôt que de générer une URL invalide", () => {
    expect(() => buildAuthorizeUrl({ redirectUri: "http://localhost/" })).toThrow();
    expect(() => buildAuthorizeUrl({ clientId: "1" })).toThrow();
  });
});

describe("generateOAuthState", () => {
  it("génère une valeur non vide, différente à chaque appel", () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("parseAuthCallback", () => {
  it("extrait code/state/scope d'un callback réussi", () => {
    const params = new URLSearchParams({ code: "abc123", state: "xyz", scope: "read,activity:read" });
    const result = parseAuthCallback(params, "xyz");
    expect(result).toEqual({ code: "abc123", state: "xyz", grantedScope: "read,activity:read" });
  });

  it("lève StravaAuthDeniedError si l'utilisateur a refusé l'autorisation", () => {
    const params = new URLSearchParams({ error: "access_denied" });
    expect(() => parseAuthCallback(params)).toThrow(StravaAuthDeniedError);
  });

  it("lève StravaInvalidCallbackError si 'code' est absent", () => {
    const params = new URLSearchParams({ state: "xyz" });
    expect(() => parseAuthCallback(params)).toThrow(StravaInvalidCallbackError);
  });

  it("lève StravaInvalidCallbackError si le state ne correspond pas (protection CSRF)", () => {
    const params = new URLSearchParams({ code: "abc", state: "wrong" });
    expect(() => parseAuthCallback(params, "expected")).toThrow(StravaInvalidCallbackError);
  });
});

describe("assertHasActivityReadScope", () => {
  it("accepte activity:read", () => {
    expect(() => assertHasActivityReadScope("read,activity:read")).not.toThrow();
  });
  it("accepte activity:read_all", () => {
    expect(() => assertHasActivityReadScope("activity:read_all")).not.toThrow();
  });
  it("lève StravaScopeError si l'utilisateur n'a accordé que 'read' (pas les activités)", () => {
    expect(() => assertHasActivityReadScope("read")).toThrow(StravaScopeError);
  });
  it("lève StravaScopeError si le scope est vide/absent — ne suppose jamais que le scope demandé a été accordé", () => {
    expect(() => assertHasActivityReadScope(null)).toThrow(StravaScopeError);
    expect(() => assertHasActivityReadScope("")).toThrow(StravaScopeError);
  });
});

describe("exchangeCodeForTokens", () => {
  it("échange un code contre des jetons via l'endpoint serveur fourni, jamais directement Strava", async () => {
    const fetchImpl = fakeFetch(200, {
      accessToken: "acc-1", refreshToken: "ref-1", expiresAt: 1717200000, scope: "activity:read", athlete: { id: 42 },
    });
    const tokens = await exchangeCodeForTokens({ code: "abc", endpoint: "/api/exchange", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("/api/exchange", expect.objectContaining({ method: "POST" }));
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody).toEqual({ code: "abc" });
    expect(tokens).toEqual({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: 1717200000, scope: "activity:read", athlete: { id: 42 } });
  });

  it("ne contient jamais client_secret dans le corps envoyé par le frontend", async () => {
    const fetchImpl = fakeFetch(200, { accessToken: "a", refreshToken: "b", expiresAt: 1 });
    await exchangeCodeForTokens({ code: "abc", fetchImpl });
    const sentBody = fetchImpl.mock.calls[0][1].body;
    expect(sentBody).not.toContain("client_secret");
    expect(sentBody).not.toContain("secret");
  });

  it("propage une erreur explicite si la réponse serveur échoue", async () => {
    const fetchImpl = fakeFetch(502, { error: "Échange impossible." });
    await expect(exchangeCodeForTokens({ code: "abc", fetchImpl })).rejects.toThrow();
  });
});

describe("refreshAccessToken", () => {
  it("rafraîchit et retourne les nouveaux jetons (le refresh_token peut avoir tourné)", async () => {
    const fetchImpl = fakeFetch(200, { accessToken: "new-acc", refreshToken: "new-ref", expiresAt: 2000000000 });
    const tokens = await refreshAccessToken({ refreshToken: "old-ref", fetchImpl });
    expect(tokens.accessToken).toBe("new-acc");
    expect(tokens.refreshToken).toBe("new-ref");
  });

  it("lève StravaRefreshError en cas d'échec (jamais une exception brute non typée)", async () => {
    const fetchImpl = fakeFetch(401, { error: "invalid_grant" });
    await expect(refreshAccessToken({ refreshToken: "old-ref", fetchImpl })).rejects.toThrow(StravaRefreshError);
  });
});

describe("revokeConnection", () => {
  it("appelle l'endpoint de révocation serveur avec le jeton, jamais le secret", async () => {
    const fetchImpl = fakeFetch(200, { ok: true });
    await revokeConnection({ accessToken: "acc-1", fetchImpl });
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody).toEqual({ accessToken: "acc-1" });
  });
});

describe("isTokenExpired / ensureFreshTokens", () => {
  it("considère un jeton sans expiresAt comme expiré", () => {
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired({})).toBe(true);
  });

  it("considère un jeton expiré au-delà de la marge de sécurité", () => {
    const nowSec = Date.now() / 1000;
    expect(isTokenExpired({ expiresAt: nowSec + 60 })).toBe(true); // < marge par défaut (300s)
    expect(isTokenExpired({ expiresAt: nowSec + 3600 })).toBe(false);
  });

  it("ensureFreshTokens ne rafraîchit pas un jeton encore valide", async () => {
    const nowSec = Date.now() / 1000;
    const tokens = { accessToken: "a", refreshToken: "b", expiresAt: nowSec + 3600 };
    const { tokens: result, refreshed } = await ensureFreshTokens(tokens);
    expect(refreshed).toBe(false);
    expect(result).toBe(tokens);
  });

  it("ensureFreshTokens rafraîchit un jeton expiré", async () => {
    const fetchImpl = fakeFetch(200, { accessToken: "new-a", refreshToken: "new-b", expiresAt: 2000000000 });
    const tokens = { accessToken: "old-a", refreshToken: "old-b", expiresAt: 0 };
    const { tokens: result, refreshed } = await ensureFreshTokens(tokens, { fetchImpl });
    expect(refreshed).toBe(true);
    expect(result.accessToken).toBe("new-a");
  });
});

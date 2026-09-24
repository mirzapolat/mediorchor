// The browser side of passkeys (WebAuthn): runs the device's prompt with the
// options the server generated and hands the response back for verification.
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import type { ApiError } from '@/lib/api';

export const passkeysSupported = () => browserSupportsWebAuthn();

// Cancelling or timing out the prompt is not worth an error message.
const toError = (err: unknown): ApiError => {
  if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return { message: err.message, code: 'passkey_exists' };
  }
  if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
    return { message: err.message, code: 'passkey_cancelled' };
  }
  return { message: err instanceof Error ? err.message : String(err), code: 'passkey_failed' };
};

export const getPasskey = async (
  optionsJSON: Parameters<typeof startAuthentication>[0]['optionsJSON'],
): Promise<{ credential: unknown; error: null } | { credential: null; error: ApiError }> => {
  try {
    return { credential: await startAuthentication({ optionsJSON }), error: null };
  } catch (err) {
    return { credential: null, error: toError(err) };
  }
};

export const createPasskey = async (
  optionsJSON: Parameters<typeof startRegistration>[0]['optionsJSON'],
): Promise<{ credential: unknown; error: null } | { credential: null; error: ApiError }> => {
  try {
    return { credential: await startRegistration({ optionsJSON }), error: null };
  } catch (err) {
    return { credential: null, error: toError(err) };
  }
};
